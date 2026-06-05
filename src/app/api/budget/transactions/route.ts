import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

interface TxRow {
  id: string;
  date: string;
  payee: string;
  amount: number;
  memo: string | null;
}

// Transactions that make up a category's activity (Toteuma) for a given month.
// Mirrors the activity computation in /api/budget: outflows only, excluding transfers,
// starting balances and reconciliations.
export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const url = new URL(request.url);
    const month = url.searchParams.get("month") || "";
    const category = url.searchParams.get("category") || "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
    }

    const [y, m] = month.split("-").map(Number);
    const start = `${month}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${month}-${String(lastDay).padStart(2, "0")}`;

    const db = getDb();
    const rows = db
      .prepare(
        "SELECT id, date, payee, amount, memo FROM transactions " +
          "WHERE category = ? AND date >= ? AND date <= ? AND amount < 0 " +
          "AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' AND payee NOT LIKE 'Reconciliation%' " +
          "ORDER BY date DESC, id DESC"
      )
      .all(category, start, end) as TxRow[];

    const total = Math.round(rows.reduce((s, r) => s + Math.abs(r.amount), 0) * 100) / 100;
    console.debug("[budget/transactions]", month, category, "->", rows.length, "transactions");

    return NextResponse.json({ transactions: rows, total });
  } catch (error) {
    console.error("[budget/transactions] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
