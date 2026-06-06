import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Split a transaction across multiple categories, stored locally as child rows that share the
// parent's split_group id. Each child is a normal categorized row, so budget activity and the
// account balance stay correct unchanged. YNAB's API cannot update an existing transaction into
// a split, so this is a Dough-side split (YNAB keeps the original single line).
//
// Body: { transaction_id, splits: [{ category, amount }] } where amount is a positive expense
// amount. A single split collapses the transaction back to one category (unsplit).
export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const txId = String(body.transaction_id || "");
    const splits = Array.isArray(body.splits) ? body.splits : [];
    if (!txId || splits.length === 0) {
      return NextResponse.json({ error: "transaction_id and at least one split required" }, { status: 400 });
    }

    const db = getDb();
    const parent = db.prepare("SELECT ynab_id, date, amount, payee, account_id, memo FROM transactions WHERE ynab_id = ?").get(txId) as
      | { ynab_id: string; date: string; amount: number; payee: string; account_id: string; memo: string }
      | undefined;
    if (!parent) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

    const sign = parent.amount < 0 ? -1 : 1; // preserve inflow/outflow direction
    const total = Math.round(Math.abs(parent.amount) * 100) / 100;

    // Clean numbers and auto-distribute any rounding remainder into the last line so the children
    // always sum to the original total (keeps the account balance unchanged).
    const lines = splits
      .map((s: any) => ({ category: String(s.category || ""), amount: Math.round((Number(s.amount) || 0) * 100) / 100 }))
      .filter((s: { amount: number }) => s.amount > 0);
    if (lines.length === 0) return NextResponse.json({ error: "splits must have positive amounts" }, { status: 400 });
    const sum = Math.round(lines.reduce((a: number, s: { amount: number }) => a + s.amount, 0) * 100) / 100;
    const remainder = Math.round((total - sum) * 100) / 100;
    if (remainder !== 0) lines[lines.length - 1].amount = Math.round((lines[lines.length - 1].amount + remainder) * 100) / 100;

    const childIds = db.prepare("SELECT ynab_id FROM transactions WHERE split_group = ? AND ynab_id != ?").all(txId, txId) as { ynab_id: string }[];

    const run = db.transaction(() => {
      // Remove any previous children of this split
      db.prepare("DELETE FROM transactions WHERE split_group = ? AND ynab_id != ?").run(txId, txId);

      if (lines.length === 1) {
        // Collapse back to a single, unsplit transaction
        db.prepare("UPDATE transactions SET category = ?, amount = ?, split_group = '' WHERE ynab_id = ?")
          .run(lines[0].category, sign * lines[0].amount, txId);
        return;
      }

      // Parent row becomes the first child; remaining lines become sibling child rows
      db.prepare("UPDATE transactions SET category = ?, amount = ?, split_group = ? WHERE ynab_id = ?")
        .run(lines[0].category, sign * lines[0].amount, txId, txId);

      const insert = db.prepare(
        "INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared, split_group) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'cleared', ?)"
      );
      for (let i = 1; i < lines.length; i++) {
        insert.run(user.id, `split_${txId}_${i}`, parent.date, sign * lines[i].amount, parent.payee, lines[i].category, parent.memo || "", parent.account_id || "", txId);
      }
    });
    run();

    console.info("[ynab/transaction/split]", txId, lines.length === 1 ? "unsplit" : `split into ${lines.length}`, "(removed", childIds.length, "old children)");
    eventBus.emit("data:updated", { source: "transaction-split", userId: user.id });
    return NextResponse.json({ success: true, parts: lines.length });
  } catch (error) {
    console.error("[ynab/transaction/split] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
