import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getHouseholdSetting, setHouseholdSetting, getBudgetMode, secretsEqual } from "@/lib/household";
import { getAllPatterns } from "@/lib/matching";
import { eventBus } from "@/lib/event-bus";
import { INTERNAL_TRANSFER_CATEGORY, normTransferPayee, isGenericTransferPayee } from "@/lib/transaction-utils";
import { categoryByPayeeAmount } from "@/lib/categorize-history";
import { localDateIso } from "@/lib/date-utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Synci income sync — polls Synci API for income transactions on mapped accounts,
 * matches against income source patterns, creates YNAB transactions, marks as received.
 *
 * Called periodically or manually from the dashboard/settings.
 */

function patternToMatcher(pattern: string): (payee: string) => boolean {
  const trimmed = pattern.trim();
  if (trimmed.startsWith("*") && trimmed.endsWith("*")) {
    const inner = trimmed.slice(1, -1).toLowerCase();
    return (payee) => payee.toLowerCase().includes(inner);
  }
  if (trimmed.startsWith("*")) {
    const inner = trimmed.slice(1).toLowerCase();
    return (payee) => payee.toLowerCase().endsWith(inner);
  }
  if (trimmed.endsWith("*")) {
    const inner = trimmed.slice(0, -1).toLowerCase();
    return (payee) => payee.toLowerCase().startsWith(inner);
  }
  return (payee) => payee.toLowerCase() === trimmed.toLowerCase();
}

export async function POST(request: Request) {
  try {
    // Allow cron calls with X-Cron-Secret header matching household setting
    const cronSecret = request.headers.get("x-cron-secret");
    const expectedSecret = getHouseholdSetting("cron_secret");
    const isCron = secretsEqual(cronSecret, expectedSecret);

    if (!isCron) {
      const user = await getSession();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const synciToken = getHouseholdSetting("synci_api_token");
    if (!synciToken) {
      return NextResponse.json({ error: "Synci not configured" }, { status: 400 });
    }

    // Load account mapping
    let accountMapping: Record<string, string> = {};
    const mappingJson = getHouseholdSetting("synci_account_mapping");
    if (mappingJson) {
      try { accountMapping = JSON.parse(mappingJson); } catch {}
    }

    const mappedAccountIds = Object.keys(accountMapping).filter((k) => accountMapping[k]);
    if (mappedAccountIds.length === 0) {
      return NextResponse.json({ error: "No accounts mapped", matched: 0 });
    }

    const db = getDb();
    const mode = getBudgetMode();
    const patterns = getAllPatterns().filter((p) => p.source_type === "income");
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const firstUser = db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get() as { id: number } | undefined;

    let totalMatched = 0;
    let totalImported = 0;
    const toCategorize: { id: string; payee: string; amount: number }[] = []; // newly imported expenses to categorize

    // The transactions feed is GLOBAL: the API ignores its bank_account_id filter (and plain
    // ?page=), so per-account polling just fetched the same newest page over and over, and any
    // transaction that rotated past that page between polls was never seen - a quiet account's
    // purchases were pushed out by busier accounts and silently lost. Pagination works JSON:API
    // style (page[number], page[size]), so walk every page of the feed each run; the dedup below
    // makes already-imported transactions no-ops. Each transaction is attributed to its own
    // financial_account_id, so one global walk covers every mapped account.
    let lastPage = 1;
    for (let pageNo = 1; pageNo <= lastPage; pageNo++) {
      console.info("[synci/sync] Fetching transactions page", pageNo, "of", lastPage, "mode:", mode);

      const res = await fetch(`https://api.synci.io/api/v1/banks/transactions?page%5Bnumber%5D=${pageNo}&page%5Bsize%5D=100`, {
        headers: { Authorization: `Bearer ${synciToken}` },
        signal: AbortSignal.timeout(25000),
      });

      if (!res.ok) {
        console.error("[synci/sync] API error on transactions page", pageNo, res.status);
        break;
      }

      const data = await res.json();
      const transactions = data.data || [];
      lastPage = data.meta?.last_page || lastPage;

      for (const tx of transactions) {
        const amount = parseFloat(tx.amount) || 0;

        const payee = tx.mapped_fields?.payee || tx.creditor?.name || tx.debtor?.name || tx.remittance_information?.unstructured || tx.mapped_fields?.description || "Unknown";
        const txId = tx.id ? String(tx.id) : "";
        // Prefer value_date (when the purchase actually happened, which is what the bank shows)
        // over booking_date (when it later posted/cleared). Using booking_date stamped purchases
        // with their clearing date instead of the real transaction date.
        const txDate = tx.value_date || tx.booking_date || tx.mapped_fields?.date || "";
        // Attribute to the transaction's OWN account: the feed is global, so this is the only
        // account signal. A transaction without one cannot be filed and is skipped below (its
        // empty mapping resolves to no local account).
        const txSynciAccount = tx.financial_account_id != null ? String(tx.financial_account_id) : "";

        if (!txId) continue;

        // Dedup. Synci re-issues its own transaction id when a bank is deleted and reconnected, so
        // the same bank transaction would otherwise import again under a new id. Dedup also on the
        // bank's own stable reference (institution_transaction_id) plus the amount, which survives a
        // reconnect. The two legs of a transfer share that reference but differ in amount, so both
        // still import. Nothing is deleted here - a duplicate is simply not imported again.
        const synciTxId = `synci_${txId}`;
        const instId = tx.external_identifiers?.institution_transaction_id ? String(tx.external_identifiers.institution_transaction_id) : "";
        const bankFingerprint = instId ? `bank_${instId}_${amount.toFixed(2)}` : "";
        const markProcessed = () => {
          for (const key of [synciTxId, bankFingerprint].filter(Boolean)) {
            db.prepare("INSERT OR IGNORE INTO synci_processed (synci_tx_id) VALUES (?)").run(key);
          }
        };
        const alreadyProcessed = db.prepare("SELECT synci_tx_id FROM synci_processed WHERE synci_tx_id = ?").get(synciTxId)
          || (bankFingerprint ? db.prepare("SELECT synci_tx_id FROM synci_processed WHERE synci_tx_id = ?").get(bankFingerprint) : undefined);
        if (alreadyProcessed) continue;

        const matchMonth = txDate ? `${txDate.split("-")[0]}-${txDate.split("-")[1]}` : currentMonth;

        // LOCAL MODE: import every transaction (income and expense) straight into Dough,
        // no YNAB round trip. Dormant while YNAB is connected.
        if (mode === "local") {
          const localAccountId = accountMapping[txSynciAccount] || "";
          const importDate = txDate || localDateIso(now);
          // Skip if this transaction is already present from a manual entry, matched by amount and
          // date on the SAME account. Matching across all accounts (the old YNAB-cutover behaviour)
          // ate real purchases: an everyday round-sum card payment matched a same-size
          // transfer leg on a different account days earlier and the purchase was permanently
          // dropped, leaving the account's balance above the bank's. The date is matched within a
          // +/-4 day window because the booking date can differ from the value date.
          const manualDup = localAccountId ? db.prepare(
            "SELECT 1 FROM transactions WHERE account_id = ? AND ROUND(amount, 2) = ROUND(?, 2) AND date BETWEEN date(?, '-4 days') AND date(?, '+4 days') AND ynab_id NOT LIKE 'synci_%' LIMIT 1"
          ).get(localAccountId, amount, importDate, importDate) : undefined;
          if (manualDup) {
            console.info("[synci/sync] Skipping duplicate of an existing transaction:", payee, amount, "on", importDate);
            markProcessed();
            continue;
          }
          // Recognise household income by pattern. A matched inflow is categorised to Ready to
          // Assign and counts toward the budget.
          let incomeCategory = "";
          let matchedSourceId: number | null = null;
          let provisionalInflow = false;
          if (amount > 0) {
            for (const pattern of patterns) {
              const matcher = patternToMatcher(pattern.payee_pattern);
              if (!matcher(payee)) continue;
              if (pattern.min_amount > 0 && amount < pattern.min_amount) continue;
              if (pattern.max_amount > 0 && amount > pattern.max_amount) continue;
              incomeCategory = "Inflow: Ready to Assign";
              matchedSourceId = pattern.source_id;
              break;
            }
            // An inflow matching no household income source is either the incoming leg of an
            // internal transfer (money from another own account) or genuinely external money
            // (e.g. a client paying through a personal account). Import it uncategorised: the
            // transfer-pairing pass below claims it if it pairs with an opposite leg, otherwise it
            // is categorised as Ready to Assign income (never deleted), so it is always accounted for.
            if (!matchedSourceId) provisionalInflow = true;
          }
          if (localAccountId && firstUser) {
            db.prepare(`
              INSERT OR IGNORE INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared)
              VALUES (?, ?, ?, ?, ?, ?, 'Synci', ?, 1, 'cleared')
            `).run(firstUser.id, synciTxId, importDate, amount, payee, incomeCategory, localAccountId);
            db.prepare("UPDATE ynab_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
              .run(amount, localAccountId);
            totalImported++;
            // Only unrecognised outflows need AI categorising; matched income is already placed.
            if (amount < 0) toCategorize.push({ id: synciTxId, payee, amount });
            console.info("[synci/sync] Imported", payee, amount, incomeCategory ? "(income)" : provisionalInflow ? "(provisional inflow)" : "", "to account", localAccountId);
          }
          // Mark a matched income source as received this month
          if (matchedSourceId != null) {
            db.prepare(`INSERT OR IGNORE INTO monthly_matches (source_type, source_id, month, ynab_transaction_id, amount) VALUES (?, ?, ?, ?, ?)`)
              .run("income", matchedSourceId, matchMonth, synciTxId, amount);
            db.prepare(`INSERT INTO income_amount_history (income_id, amount, month) VALUES (?, ?, ?) ON CONFLICT(income_id, month) DO UPDATE SET amount = excluded.amount`)
              .run(matchedSourceId, amount, matchMonth);
            totalMatched++;
          }
          markProcessed();
          continue;
        }

        // YNAB MODE (unchanged): income only, created in YNAB then mirrored
        if (amount <= 0) { markProcessed(); continue; }

        console.info("[synci/sync] Income found:", payee, amount, "EUR on", txDate);

        // Match against income patterns
        let didMatch = false;
        for (const pattern of patterns) {
          const matcher = patternToMatcher(pattern.payee_pattern);
          if (!matcher(payee)) continue;
          if (pattern.min_amount > 0 && amount < pattern.min_amount) continue;
          if (pattern.max_amount > 0 && amount > pattern.max_amount) continue;

          try {
            // The money actually landed on the account we polled, so that mapping wins. The
            // income source's target_account_id is only a fallback when an account is unmapped.
            // (Previously the override took priority, which misfiled income onto the wrong
            // person's account when a source was configured for a different account.)
            const overrideAccount = db.prepare("SELECT target_account_id FROM income_sources WHERE id = ?").get(pattern.source_id) as { target_account_id: string } | undefined;
            const ynabAccountId = (accountMapping[txSynciAccount] || overrideAccount?.target_account_id || "");
            const ynabToken = getHouseholdSetting("ynab_access_token");
            const ynabBudgetId = getHouseholdSetting("ynab_budget_id");
            let realYnabId = synciTxId;

            // Create in YNAB first to get real ID
            if (ynabToken && ynabBudgetId && ynabAccountId) {
              try {
                const { createTransaction } = await import("@/lib/ynab/client");
                const ynabTx = await createTransaction(ynabBudgetId, ynabToken, {
                  account_id: ynabAccountId,
                  date: txDate || localDateIso(now),
                  amount,
                  payee_name: payee,
                  memo: "Synci",
                  cleared: "cleared",
                });
                if (ynabTx?.id) realYnabId = ynabTx.id;
                console.info("[synci/sync] Created YNAB transaction:", payee, amount, "id:", realYnabId);
              } catch (err) {
                console.error("[synci/sync] YNAB create error:", err);
              }
            }

            db.prepare(`
              INSERT OR IGNORE INTO monthly_matches (source_type, source_id, month, ynab_transaction_id, amount)
              VALUES (?, ?, ?, ?, ?)
            `).run("income", pattern.source_id, matchMonth, realYnabId, amount);

            db.prepare(`
              INSERT INTO income_amount_history (income_id, amount, month)
              VALUES (?, ?, ?)
              ON CONFLICT(income_id, month) DO UPDATE SET amount = excluded.amount
            `).run(pattern.source_id, amount, matchMonth);

            // Insert as transaction in Dough with the real YNAB ID
            const firstUser = db.prepare("SELECT id FROM users LIMIT 1").get() as { id: number } | undefined;
            if (firstUser && ynabAccountId) {
              db.prepare(`
                INSERT OR IGNORE INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared)
                VALUES (?, ?, ?, ?, ?, '', 'Synci', ?, 1, 'cleared')
              `).run(firstUser.id, realYnabId, txDate || localDateIso(now), amount, payee, ynabAccountId);

              db.prepare("UPDATE ynab_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?")
                .run(amount, ynabAccountId);

              console.info("[synci/sync] Inserted transaction:", payee, amount, "into account", ynabAccountId);
            }

            totalMatched++;
            didMatch = true;
            console.info("[synci/sync] Matched income:", payee, "→ source", pattern.source_id);
          } catch (err) {
            console.warn("[synci/sync] Match insert error:", err);
          }
          break;
        }

        if (!didMatch) {
          console.debug("[synci/sync] Skipping unmatched income:", payee, amount);
        }

        // Mark as processed regardless of YNAB creation
        markProcessed();
      }
    }

    // LOCAL MODE: auto-pair transfers between household accounts.
    // Opposite-sign Synci transactions of equal magnitude within 2 days, on
    // different accounts, get relabelled "Transfer : <other account>" so they
    // are excluded from spending/income stats by isTransfer().
    let transfersPaired = 0;
    if (mode === "local") {
      const acctNames = new Map(
        (db.prepare("SELECT id, name FROM ynab_accounts").all() as { id: string; name: string }[]).map((a) => [a.id, a.name])
      );
      // Local accounts that Synci itself feeds: their transfer legs always arrive from the bank, so
      // the counterpart-filling passes must never fabricate a leg for them (it would double the
      // transfer when the real leg lands and permanently drift the account balance).
      const syncedLocalIds = new Set(Object.values(accountMapping).filter(Boolean));
      // Pattern-matched household income (in monthly_matches) is excluded so a real paycheck is
      // never eaten by a same-size outflow on another account and mislabelled a transfer. An inflow
      // the FALLBACK filed as income stays a candidate: its opposite leg often arrives days later
      // (banks deliver accounts at different cadences), and without re-pairing it the money counts
      // as income on one account while the other side ends up a transfer with no counterpart -
      // inflating income and drifting balances. Confirmed transfers stay excluded.
      const candidates = db.prepare(
        "SELECT ynab_id, date, amount, account_id FROM transactions " +
          "WHERE ynab_id LIKE 'synci_%' AND payee NOT LIKE 'Transfer%' " +
          "AND category != 'Internal transfer' " +
          "AND (category != 'Inflow: Ready to Assign' OR ynab_id NOT IN (SELECT ynab_transaction_id FROM monthly_matches)) " +
          "AND date >= date('now', '-45 days') ORDER BY date"
      ).all() as { ynab_id: string; date: string; amount: number; account_id: string }[];
      const paired = new Set<string>();
      for (let i = 0; i < candidates.length; i++) {
        const a = candidates[i];
        if (paired.has(a.ynab_id)) continue;
        for (let j = i + 1; j < candidates.length; j++) {
          const b = candidates[j];
          if (paired.has(b.ynab_id)) continue;
          if (a.account_id === b.account_id) continue;
          if (Math.abs(a.amount + b.amount) > 0.001) continue; // must be exact opposites
          const days = Math.abs((new Date(a.date).getTime() - new Date(b.date).getTime()) / 86400000);
          if (days > 2) continue;
          const aName = acctNames.get(a.account_id) || "";
          const bName = acctNames.get(b.account_id) || "";
          // Relabel both legs as a transfer and tag them with the internal-transfer category so
          // they read as a transfer everywhere (and stay out of spending/income via isTransfer()).
          db.prepare("UPDATE transactions SET payee = ?, category = ? WHERE ynab_id = ?").run(`Transfer : ${bName}`, INTERNAL_TRANSFER_CATEGORY, a.ynab_id);
          db.prepare("UPDATE transactions SET payee = ?, category = ? WHERE ynab_id = ?").run(`Transfer : ${aName}`, INTERNAL_TRANSFER_CATEGORY, b.ynab_id);
          paired.add(a.ynab_id); paired.add(b.ynab_id);
          transfersPaired++;
          break;
        }
      }
      if (transfersPaired > 0) console.info("[synci/sync] Auto-paired", transfersPaired, "transfers");

      // Pass two: attach a still-unmatched leg (either sign - banks deliver the two sides at
      // different cadences) to an existing single-leg internal transfer already marked by the user
      // or paired earlier. Only legs that do not already have an opposite internal-transfer leg
      // qualify, so a complete transfer is never disturbed.
      const lateInflows = db.prepare(
        "SELECT ynab_id, date, amount, account_id FROM transactions " +
          "WHERE ynab_id LIKE 'synci_%' AND ROUND(amount, 2) != 0 AND payee NOT LIKE 'Transfer%' " +
          "AND COALESCE(category, '') = '' AND date >= date('now', '-45 days')"
      ).all() as { ynab_id: string; date: string; amount: number; account_id: string }[];
      for (const inf of lateInflows) {
        if (paired.has(inf.ynab_id)) continue;
        const out = db.prepare(
          "SELECT o.ynab_id, o.account_id FROM transactions o " +
            "WHERE o.category = 'Internal transfer' AND ROUND(o.amount, 2) = ROUND(?, 2) AND o.account_id != ? " +
            "AND ABS(julianday(o.date) - julianday(?)) <= 2 " +
            "AND NOT EXISTS (SELECT 1 FROM transactions z WHERE z.category = 'Internal transfer' AND ROUND(z.amount, 2) = ROUND(?, 2) AND z.account_id != o.account_id AND ABS(julianday(z.date) - julianday(o.date)) <= 2) " +
            "LIMIT 1"
        ).get(-inf.amount, inf.account_id, inf.date, inf.amount) as { ynab_id: string; account_id: string } | undefined;
        if (!out) continue;
        const outName = acctNames.get(out.account_id) || "";
        const infName = acctNames.get(inf.account_id) || "";
        db.prepare("UPDATE transactions SET payee = ?, category = ? WHERE ynab_id = ?").run(`Transfer : ${outName}`, INTERNAL_TRANSFER_CATEGORY, inf.ynab_id);
        // Relabel the existing leg too: it can still carry the person payee from before pairing,
        // which reads as a transfer without a counterpart account in the UI.
        db.prepare("UPDATE transactions SET payee = ? WHERE ynab_id = ? AND payee NOT LIKE 'Transfer%'").run(`Transfer : ${infName}`, out.ynab_id);
        paired.add(inf.ynab_id);
        transfersPaired++;
      }

      // Pass three: an inflow whose payee the household has previously confirmed as an internal
      // transfer is itself a transfer (e.g. money moved in from an account Synci does not sync, where
      // the bank shows the owner's own name as the payee). Mark it so it stops counting as income.
      // The payee list is learned from confirmed transfers, never hardcoded. Matching is on sorted
      // name tokens so a reordered name (surname-first vs first-name-first) still matches.
      const normPayee = normTransferPayee;
      let knownTransferPayees = new Set<string>();
      try {
        const raw = getHouseholdSetting("internal_transfer_payees");
        if (raw) knownTransferPayees = new Set((JSON.parse(raw) as string[]).map(normPayee).filter(Boolean));
      } catch { knownTransferPayees = new Set(); }
      // Learned payee -> counterpart-account map: lets a single-leg inflow (only the receiving side
      // synced) get its Vastatili and a recreated opposite leg, mirroring what the edit dialog does.
      let transferPayeeAccounts: Record<string, string> = {};
      try {
        const rawMap = getHouseholdSetting("transfer_payee_accounts");
        if (rawMap) transferPayeeAccounts = JSON.parse(rawMap) as Record<string, string>;
      } catch { transferPayeeAccounts = {}; }
      // Self-heal: also treat the real payee of any already-confirmed internal transfer as a known
      // transfer payee. This learns from transfers fixed directly (e.g. in the DB) or otherwise never
      // routed through the edit dialog's payee learning, so a recurring person-to-person transfer is
      // recognised next time. Generic "Transfer : <account>" leg descriptors are excluded.
      try {
        const confirmed = db.prepare(
          "SELECT DISTINCT payee FROM transactions WHERE category = ? AND payee IS NOT NULL AND payee != '' AND payee NOT LIKE 'Transfer%'"
        ).all(INTERNAL_TRANSFER_CATEGORY) as { payee: string }[];
        for (const c of confirmed) {
          if (!isGenericTransferPayee(c.payee)) knownTransferPayees.add(normPayee(c.payee));
        }
      } catch (e) { console.warn("[synci/sync] Failed to derive transfer payees from confirmed transfers:", e); }
      if (knownTransferPayees.size > 0) {
        const unmatchedInflows = db.prepare(
          "SELECT ynab_id, payee, date, amount, account_id FROM transactions " +
            "WHERE ynab_id LIKE 'synci_%' AND amount > 0 AND payee NOT LIKE 'Transfer%' " +
            "AND COALESCE(category, '') = '' AND date >= date('now', '-45 days')"
        ).all() as { ynab_id: string; payee: string; date: string; amount: number; account_id: string }[];
        for (const inf of unmatchedInflows) {
          if (paired.has(inf.ynab_id)) continue;
          if (!inf.payee || !knownTransferPayees.has(normPayee(inf.payee))) continue;
          // When the household has confirmed which account this payee transfers from, fill the
          // Vastatili: relabel the inflow "Transfer : <counterpart>". The opposite leg is reused
          // when the bank already delivered it, FABRICATED only when the counterpart account is not
          // Synci-fed (its leg can never arrive by itself). For a bank-fed counterpart the real leg
          // arrives on its own schedule and pass two attaches it - fabricating one here doubled the
          // transfer and drifted the counterpart balance. Falls back to category-only when the
          // counterpart is unknown or would be the inflow's own account.
          const counterAcct = transferPayeeAccounts[normPayee(inf.payee)];
          if (counterAcct && counterAcct !== inf.account_id && acctNames.has(counterAcct) && firstUser) {
            const counterName = acctNames.get(counterAcct) || "";
            const thisName = acctNames.get(inf.account_id) || "";
            const counterSigned = -inf.amount;
            // Reuse an unclassified opposite-amount leg on the counterpart account if one happens to
            // exist. Never touch a leg that is already a transfer or a categorised real expense.
            const existing = db.prepare(
              "SELECT ynab_id FROM transactions WHERE account_id = ? AND ROUND(amount, 2) = ROUND(?, 2) " +
                "AND COALESCE(category, '') = '' AND date BETWEEN date(?, '-2 days') AND date(?, '+2 days') LIMIT 1"
            ).get(counterAcct, counterSigned, inf.date, inf.date) as { ynab_id: string } | undefined;
            if (existing) {
              db.prepare("UPDATE transactions SET payee = ?, category = ? WHERE ynab_id = ?")
                .run(`Transfer : ${thisName}`, INTERNAL_TRANSFER_CATEGORY, existing.ynab_id);
              paired.add(existing.ynab_id);
            } else if (!syncedLocalIds.has(counterAcct)) {
              db.prepare("INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared) VALUES (?, ?, ?, ?, ?, ?, 'Synci', ?, 1, 'cleared')")
                .run(firstUser.id, `local_${randomUUID()}`, inf.date, counterSigned, `Transfer : ${thisName}`, INTERNAL_TRANSFER_CATEGORY, counterAcct);
              db.prepare("UPDATE ynab_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?").run(counterSigned, counterAcct);
            }
            db.prepare("UPDATE transactions SET payee = ?, category = ? WHERE ynab_id = ?")
              .run(`Transfer : ${counterName}`, INTERNAL_TRANSFER_CATEGORY, inf.ynab_id);
            console.info("[synci/sync] Filled transfer counterpart for a single-leg inflow");
            paired.add(inf.ynab_id);
            transfersPaired++;
          }
          // No counterpart known: leave the row alone. An internal transfer must always carry its
          // counterpart account; marking category-only here created transfers that read as
          // "no second account (external)". The row stays classifiable by a later pass or run
          // (once the opposite leg arrives or the payee's counterpart is learned), or by the user,
          // whose correction teaches the counterpart map.
        }
      }

      // Pass four: an OUTFLOW whose payee the household has confirmed as an internal transfer is a
      // transfer out to an own account (e.g. money moved to an external account Synci does not sync).
      // Symmetric to pass three: the bank delivers only the sending leg, so mark it a transfer and,
      // when the counterpart account is known, fill the Vastatili and recreate the receiving leg on
      // it. Without this an outflow to an own account keeps showing up as an expense.
      if (knownTransferPayees.size > 0) {
        const unmatchedOutflows = db.prepare(
          "SELECT ynab_id, payee, date, amount, account_id FROM transactions " +
            "WHERE ynab_id LIKE 'synci_%' AND amount < 0 AND payee NOT LIKE 'Transfer%' " +
            "AND COALESCE(category, '') = '' AND date >= date('now', '-45 days')"
        ).all() as { ynab_id: string; payee: string; date: string; amount: number; account_id: string }[];
        for (const out of unmatchedOutflows) {
          if (paired.has(out.ynab_id)) continue;
          if (!out.payee || !knownTransferPayees.has(normPayee(out.payee))) continue;
          const counterAcct = transferPayeeAccounts[normPayee(out.payee)];
          if (counterAcct && counterAcct !== out.account_id && acctNames.has(counterAcct) && firstUser) {
            const counterName = acctNames.get(counterAcct) || "";
            const thisName = acctNames.get(out.account_id) || "";
            const counterSigned = -out.amount; // the receiving leg is a positive inflow on the counterpart
            // Reuse an unclassified opposite-amount leg on the counterpart account if one exists.
            // Fabricate one only when the counterpart is not Synci-fed (see pass three): for a
            // bank-fed account the real leg arrives on its own and pass two attaches it.
            const existing = db.prepare(
              "SELECT ynab_id FROM transactions WHERE account_id = ? AND ROUND(amount, 2) = ROUND(?, 2) " +
                "AND COALESCE(category, '') = '' AND date BETWEEN date(?, '-2 days') AND date(?, '+2 days') LIMIT 1"
            ).get(counterAcct, counterSigned, out.date, out.date) as { ynab_id: string } | undefined;
            if (existing) {
              db.prepare("UPDATE transactions SET payee = ?, category = ? WHERE ynab_id = ?")
                .run(`Transfer : ${thisName}`, INTERNAL_TRANSFER_CATEGORY, existing.ynab_id);
              paired.add(existing.ynab_id);
            } else if (!syncedLocalIds.has(counterAcct)) {
              db.prepare("INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared) VALUES (?, ?, ?, ?, ?, ?, 'Synci', ?, 1, 'cleared')")
                .run(firstUser.id, `local_${randomUUID()}`, out.date, counterSigned, `Transfer : ${thisName}`, INTERNAL_TRANSFER_CATEGORY, counterAcct);
              db.prepare("UPDATE ynab_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?").run(counterSigned, counterAcct);
            }
            db.prepare("UPDATE transactions SET payee = ?, category = ? WHERE ynab_id = ?")
              .run(`Transfer : ${counterName}`, INTERNAL_TRANSFER_CATEGORY, out.ynab_id);
            console.info("[synci/sync] Filled transfer counterpart for a single-leg outflow");
            paired.add(out.ynab_id);
            transfersPaired++;
          }
          // No counterpart known: leave the row alone (see pass three) - never a transfer
          // without its counterpart account.
        }
      }

      // Pass five: self-heal transfer legs that carry the internal-transfer category but still show
      // the original person payee (no "Transfer : <account>" label, which the UI reads as a transfer
      // with no counterpart). Once the opposite leg exists, relabel with its account so an internal
      // transfer always names its Vastatili.
      const unlabeled = db.prepare(
        "SELECT ynab_id, date, amount, account_id FROM transactions " +
          "WHERE category = 'Internal transfer' AND payee NOT LIKE 'Transfer%'"
      ).all() as { ynab_id: string; date: string; amount: number; account_id: string }[];
      let relabeled = 0;
      for (const leg of unlabeled) {
        const opposite = db.prepare(
          "SELECT account_id FROM transactions WHERE category = 'Internal transfer' AND ROUND(amount, 2) = ROUND(?, 2) " +
            "AND account_id != ? AND ABS(julianday(date) - julianday(?)) <= 2 LIMIT 1"
        ).get(-leg.amount, leg.account_id, leg.date) as { account_id: string } | undefined;
        if (!opposite) continue;
        const oppName = acctNames.get(opposite.account_id) || "";
        if (!oppName) continue;
        db.prepare("UPDATE transactions SET payee = ? WHERE ynab_id = ?").run(`Transfer : ${oppName}`, leg.ynab_id);
        relabeled++;
      }
      if (relabeled > 0) console.info("[synci/sync] Relabeled", relabeled, "transfer legs with their counterpart account");

      // Any inflow that matched no income source and did not pair as a transfer above is real income
      // (e.g. a client paying through a personal account). Categorise it to Ready to Assign so it is
      // accounted for and assignable in the budget. Transactions are NEVER deleted here: same-account
      // transfers are already paired above, and a transfer recognised later can be reclassified from
      // the edit dialog (which teaches the transfer-payee list for next time).
      const unrecognised = db.prepare(
        "SELECT ynab_id, payee FROM transactions " +
          "WHERE ynab_id LIKE 'synci_%' AND amount > 0 AND payee NOT LIKE 'Transfer%' " +
          "AND COALESCE(category, '') = ''"
      ).all() as { ynab_id: string; payee: string }[];
      for (const row of unrecognised) {
        // An inflow from a payee the household only spends at is a REFUND of past spending, not
        // income: it returns to the payee's usual expense category (reducing that category's
        // activity, matching YNAB), instead of inflating income with e.g. a food-courier refund.
        const refund = row.payee ? (db.prepare(
          "SELECT category FROM transactions WHERE LOWER(payee) = LOWER(?) AND amount < 0 " +
            "AND COALESCE(category, '') NOT IN ('', 'Uncategorized', 'Internal transfer') AND category NOT LIKE 'Inflow%' " +
            "GROUP BY category ORDER BY COUNT(*) DESC LIMIT 1"
        ).get(row.payee) as { category: string } | undefined)?.category : undefined;
        db.prepare("UPDATE transactions SET category = ? WHERE ynab_id = ?").run(refund || "Inflow: Ready to Assign", row.ynab_id);
        if (refund) console.info("[synci/sync] Categorised an inflow as a refund to", refund);
      }
      if (unrecognised.length > 0) console.info("[synci/sync] Categorised", unrecognised.length, "unmatched inflows (refunds to their spending category, the rest as income)");
    }

    // AI complement: categorize freshly imported expenses that Synci left uncategorized (skip
    // anything that turned out to be a transfer). Best-effort, never blocks the sync result.
    let categorized = 0;
    if (mode === "local" && toCategorize.length > 0) {
      // Inflow categories are never valid for an expense; keep them out of the model's choices so
      // a spending row can never be filed as income.
      const catNames = (db.prepare("SELECT name FROM categories WHERE is_active = 1 AND name NOT LIKE 'Inflow%'").all() as { name: string }[]).map((c) => c.name);
      if (catNames.length > 0) {
        const { categorizePayee } = await import("@/lib/ai/categorize");
        for (const item of toCategorize) {
          const row = db.prepare("SELECT category, payee FROM transactions WHERE ynab_id = ?").get(item.id) as { category: string; payee: string } | undefined;
          if (!row || row.category || row.payee.startsWith("Transfer")) continue;
          // A consistent payee+amount history (fixed recurring payment) is used directly, no model
          // call; otherwise fall back to the AI guess from the payee.
          const histCat = categoryByPayeeAmount(db, item.payee, item.amount);
          if (histCat) { db.prepare("UPDATE transactions SET category = ? WHERE ynab_id = ?").run(histCat, item.id); categorized++; continue; }
          try {
            const cat = await categorizePayee(item.payee, catNames);
            if (cat) { db.prepare("UPDATE transactions SET category = ? WHERE ynab_id = ?").run(cat, item.id); categorized++; }
          } catch (err) { console.warn("[synci/sync] categorize failed for", item.payee, err); }
        }
        if (categorized > 0) console.info("[synci/sync] AI-categorized", categorized, "imported expenses");
      }
    }

    // Update last sync time
    setHouseholdSetting("synci_last_sync", new Date().toISOString());

    if (totalMatched > 0 || totalImported > 0 || transfersPaired > 0) {
      eventBus.emit("data:updated", { source: "synci-sync" });
    }

    console.info("[synci/sync] Done. mode:", mode, "matched:", totalMatched, "imported:", totalImported, "transfers:", transfersPaired);
    return NextResponse.json({ ok: true, mode, matched: totalMatched, imported: totalImported, transfers: transfersPaired });
  } catch (error) {
    console.error("[synci/sync] Error:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
