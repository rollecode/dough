import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getHouseholdSetting, setHouseholdSetting, getBudgetMode, secretsEqual } from "@/lib/household";
import { getAllPatterns } from "@/lib/matching";
import { eventBus } from "@/lib/event-bus";
import { INTERNAL_TRANSFER_CATEGORY } from "@/lib/transaction-utils";

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
    const toCategorize: { id: string; payee: string }[] = []; // newly imported expenses for AI categorizing

    for (const synciAccountId of mappedAccountIds) {
      console.info("[synci/sync] Polling account", synciAccountId, "mode:", mode);

      const res = await fetch(`https://api.synci.io/api/v1/banks/transactions?bank_account_id=${synciAccountId}`, {
        headers: { Authorization: `Bearer ${synciToken}` },
        signal: AbortSignal.timeout(25000),
      });

      if (!res.ok) {
        console.error("[synci/sync] API error for account", synciAccountId, res.status);
        continue;
      }

      const data = await res.json();
      const transactions = data.data || [];

      for (const tx of transactions) {
        const amount = parseFloat(tx.amount) || 0;

        const payee = tx.mapped_fields?.payee || tx.creditor?.name || tx.debtor?.name || tx.remittance_information?.unstructured || tx.mapped_fields?.description || "Unknown";
        const txId = tx.id ? String(tx.id) : "";
        // Prefer value_date (when the purchase actually happened, which is what the bank shows)
        // over booking_date (when it later posted/cleared). Using booking_date stamped purchases
        // with their clearing date instead of the real transaction date.
        const txDate = tx.value_date || tx.booking_date || tx.mapped_fields?.date || "";
        // Attribute to the transaction's OWN account, not the account being polled. Synci's
        // bank_account_id filter is not strict: a poll can return transactions belonging to other
        // linked accounts (e.g. a partner's), and filing them under the polled account put one
        // person's spending on another's account. Fall back to the polled account if absent.
        const txSynciAccount = tx.financial_account_id != null ? String(tx.financial_account_id) : synciAccountId;

        if (!txId) continue;

        // Skip if already processed
        const synciTxId = `synci_${txId}`;
        const alreadyProcessed = db.prepare("SELECT synci_tx_id FROM synci_processed WHERE synci_tx_id = ?").get(synciTxId);
        if (alreadyProcessed) continue;

        const matchMonth = txDate ? `${txDate.split("-")[0]}-${txDate.split("-")[1]}` : currentMonth;

        // LOCAL MODE: import every transaction (income and expense) straight into Dough,
        // no YNAB round trip. Dormant while YNAB is connected.
        if (mode === "local") {
          const localAccountId = accountMapping[txSynciAccount] || "";
          const importDate = txDate || now.toISOString().slice(0, 10);
          // Skip if this transaction is already present from YNAB or a manual entry, matched by
          // amount but NOT account. Synci attributes a transaction to the bank account it polled,
          // while YNAB may hold the same transaction on a different account; matching on account
          // would miss those and double-count, corrupting balances after a YNAB cutover. The date
          // is matched within a +/-4 day window because the booking date (when it posts) can differ
          // from the value date (when it happened) — an exact-date match let duplicates through.
          const manualDup = db.prepare(
            "SELECT 1 FROM transactions WHERE ROUND(amount, 2) = ROUND(?, 2) AND date BETWEEN date(?, '-4 days') AND date(?, '+4 days') AND ynab_id NOT LIKE 'synci_%' LIMIT 1"
          ).get(amount, importDate, importDate);
          if (manualDup) {
            console.info("[synci/sync] Skipping duplicate of an existing transaction:", payee, amount, "on", importDate);
            db.prepare("INSERT OR IGNORE INTO synci_processed (synci_tx_id) VALUES (?)").run(synciTxId);
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
            // (e.g. a client paying through a personal account). Import it provisionally: the
            // transfer-pairing pass below keeps it if it pairs with an opposite outflow, otherwise
            // it is removed so it never inflates balances or the daily budget. Previously this was
            // skipped outright, which dropped the inflow leg and stranded transfers as expenses.
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
            if (amount < 0) toCategorize.push({ id: synciTxId, payee });
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
          db.prepare("INSERT OR IGNORE INTO synci_processed (synci_tx_id) VALUES (?)").run(synciTxId);
          continue;
        }

        // YNAB MODE (unchanged): income only, created in YNAB then mirrored
        if (amount <= 0) { db.prepare("INSERT OR IGNORE INTO synci_processed (synci_tx_id) VALUES (?)").run(synciTxId); continue; }

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
                  date: txDate || now.toISOString().slice(0, 10),
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
              `).run(firstUser.id, realYnabId, txDate || now.toISOString().slice(0, 10), amount, payee, ynabAccountId);

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
        db.prepare("INSERT OR IGNORE INTO synci_processed (synci_tx_id) VALUES (?)").run(synciTxId);
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
      // Matched household income (Ready to Assign) is excluded so a real paycheck is never eaten
      // by a same-size outflow on another account and mislabelled a transfer.
      // Matched income and already-classified transfers (paired or marked by the user) are excluded
      // so neither a real paycheck nor a confirmed transfer is re-paired into the wrong thing.
      const candidates = db.prepare(
        "SELECT ynab_id, date, amount, account_id FROM transactions " +
          "WHERE ynab_id LIKE 'synci_%' AND payee NOT LIKE 'Transfer%' " +
          "AND category != 'Inflow: Ready to Assign' AND category != 'Internal transfer' " +
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

      // Sweep unpaired provisional inflows (imported with no category, not income, not a transfer)
      // that are older than 3 days: by then the opposite transfer leg has had time to arrive in a
      // later sync, so a still-unpaired one is genuinely external money - remove it and reverse its
      // balance. Recent ones are kept so a leg arriving in a different sync can still pair.
      const stale = db.prepare(
        "SELECT ynab_id, amount, account_id FROM transactions " +
          "WHERE ynab_id LIKE 'synci_%' AND amount > 0 AND payee NOT LIKE 'Transfer%' " +
          "AND COALESCE(category, '') = '' AND date < date('now', '-3 days')"
      ).all() as { ynab_id: string; amount: number; account_id: string }[];
      for (const row of stale) {
        db.prepare("DELETE FROM transactions WHERE ynab_id = ?").run(row.ynab_id);
        db.prepare("UPDATE ynab_accounts SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?").run(row.amount, row.account_id);
        totalImported--;
      }
      if (stale.length > 0) console.info("[synci/sync] Dropped", stale.length, "unrecognised external inflows older than 3 days");
    }

    // AI complement: categorize freshly imported expenses that Synci left uncategorized (skip
    // anything that turned out to be a transfer). Best-effort, never blocks the sync result.
    let categorized = 0;
    if (mode === "local" && toCategorize.length > 0) {
      const catNames = (db.prepare("SELECT name FROM categories WHERE is_active = 1").all() as { name: string }[]).map((c) => c.name);
      if (catNames.length > 0) {
        const { categorizePayee } = await import("@/lib/ai/categorize");
        for (const item of toCategorize) {
          const row = db.prepare("SELECT category, payee FROM transactions WHERE ynab_id = ?").get(item.id) as { category: string; payee: string } | undefined;
          if (!row || row.category || row.payee.startsWith("Transfer")) continue;
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
