/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

// Splitting a transaction across categories, stored as child rows sharing the parent's id as their
// split_group. Each child is a normal categorised row, so budget activity and the account balance
// are unchanged. Shared by the session route and /api/v1/transactions/split.

export interface SplitLine {
  category: string;
  amount: number;
}

export function splitTransaction(
  userId: number,
  transactionId: string,
  splits: SplitLine[]
): { parts: number } | { error: string; code: number } {
  if (!transactionId || splits.length === 0) {
    return { error: "transaction_id and at least one split required", code: 400 };
  }

  const db = getDb();
  const parent = db
    .prepare("SELECT ynab_id, date, amount, payee, account_id, memo FROM transactions WHERE ynab_id = ?")
    .get(transactionId) as
    | { ynab_id: string; date: string; amount: number; payee: string; account_id: string; memo: string }
    | undefined;
  if (!parent) return { error: "Transaction not found", code: 404 };

  const sign = parent.amount < 0 ? -1 : 1;
  const total = Math.round(Math.abs(parent.amount) * 100) / 100;

  // Any rounding remainder goes onto the last line, so the children always sum to the original and
  // the account balance does not move.
  const lines = splits
    .map((s) => ({ category: String(s.category || ""), amount: Math.round((Number(s.amount) || 0) * 100) / 100 }))
    .filter((s) => s.amount > 0);
  if (lines.length === 0) return { error: "splits must have positive amounts", code: 400 };

  const sum = Math.round(lines.reduce((a, s) => a + s.amount, 0) * 100) / 100;
  const remainder = Math.round((total - sum) * 100) / 100;
  if (remainder !== 0) {
    lines[lines.length - 1].amount = Math.round((lines[lines.length - 1].amount + remainder) * 100) / 100;
  }

  const run = db.transaction(() => {
    db.prepare("DELETE FROM transactions WHERE split_group = ? AND ynab_id != ?").run(transactionId, transactionId);

    if (lines.length === 1) {
      db.prepare("UPDATE transactions SET category = ?, amount = ?, split_group = '' WHERE ynab_id = ?")
        .run(lines[0].category, sign * lines[0].amount, transactionId);
      return;
    }

    db.prepare("UPDATE transactions SET category = ?, amount = ?, split_group = ? WHERE ynab_id = ?")
      .run(lines[0].category, sign * lines[0].amount, transactionId, transactionId);

    const insert = db.prepare(
      "INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared, split_group) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'cleared', ?)"
    );
    for (let i = 1; i < lines.length; i++) {
      insert.run(
        userId,
        `split_${transactionId}_${i}`,
        parent.date,
        sign * lines[i].amount,
        parent.payee,
        lines[i].category,
        parent.memo || "",
        parent.account_id || "",
        transactionId
      );
    }
  });
  run();

  console.info("[split]", transactionId, lines.length === 1 ? "unsplit" : `split into ${lines.length}`);
  eventBus.emit("data:updated", { source: "transaction-split", userId });
  return { parts: lines.length };
}
