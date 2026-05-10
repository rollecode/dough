import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getHouseholdSetting, setHouseholdSetting } from "@/lib/household";
import { getAllPatterns } from "@/lib/matching";
import { eventBus } from "@/lib/event-bus";

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
    const isCron = cronSecret && expectedSecret && cronSecret === expectedSecret;

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
    const patterns = getAllPatterns().filter((p) => p.source_type === "income");
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    let totalMatched = 0;

    for (const synciAccountId of mappedAccountIds) {
      console.info("[synci/sync] Polling account", synciAccountId);

      const res = await fetch(`https://api.synci.io/api/v1/banks/transactions?bank_account_id=${synciAccountId}`, {
        headers: { Authorization: `Bearer ${synciToken}` },
      });

      if (!res.ok) {
        console.error("[synci/sync] API error for account", synciAccountId, res.status);
        continue;
      }

      const data = await res.json();
      const transactions = data.data || [];

      for (const tx of transactions) {
        const amount = parseFloat(tx.amount) || 0;
        if (amount <= 0) continue; // Only income

        const payee = tx.mapped_fields?.payee || tx.creditor?.name || tx.remittance_information?.unstructured || tx.mapped_fields?.description || "";
        const txId = tx.id ? String(tx.id) : "";
        const txDate = tx.booking_date || tx.mapped_fields?.date || "";

        if (!txId) continue;

        // Skip if already processed
        const synciTxId = `synci_${txId}`;
        const alreadyProcessed = db.prepare("SELECT synci_tx_id FROM synci_processed WHERE synci_tx_id = ?").get(synciTxId);
        if (alreadyProcessed) continue;

        const matchMonth = txDate ? `${txDate.split("-")[0]}-${txDate.split("-")[1]}` : currentMonth;

        console.info("[synci/sync] Income found:", payee, amount, "EUR on", txDate);

        // Match against income patterns
        let didMatch = false;
        for (const pattern of patterns) {
          const matcher = patternToMatcher(pattern.payee_pattern);
          if (!matcher(payee)) continue;
          if (pattern.min_amount > 0 && amount < pattern.min_amount) continue;
          if (pattern.max_amount > 0 && amount > pattern.max_amount) continue;

          try {
            // Income source may override the target account when the institution
            // deposits into a different bank account than the one the household
            // wants to track it under in YNAB
            const overrideAccount = db.prepare("SELECT target_account_id FROM income_sources WHERE id = ?").get(pattern.source_id) as { target_account_id: string } | undefined;
            const ynabAccountId = (overrideAccount?.target_account_id || accountMapping[synciAccountId] || "");
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

    // Update last sync time
    setHouseholdSetting("synci_last_sync", new Date().toISOString());

    if (totalMatched > 0) {
      eventBus.emit("data:updated", { source: "synci-income" });
    }

    console.info("[synci/sync] Done: matched", totalMatched, "income(s)");
    return NextResponse.json({ ok: true, matched: totalMatched });
  } catch (error) {
    console.error("[synci/sync] Error:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
