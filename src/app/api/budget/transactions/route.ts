import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CATEGORY_ACTIVITY_PREDICATE } from "@/lib/budget-math";

interface TxRow {
  id: string;
  date: string;
  payee: string;
  amount: number;
  memo: string | null;
  account: string;
}

// Transactions that make up a category's activity (Toteuma) for a given month.
// Mirrors the activity computation in /api/budget: outflows, counting off-budget transfers
// (investing, debt paydown) but not budget-internal transfers between on-budget accounts.
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
    // acc is aliased (not `a`) so it does not clash with the `ynab_accounts a` subquery inside
    // CATEGORY_ACTIVITY_PREDICATE. Bare column names in the predicate resolve to transactions,
    // since ynab_accounts has no payee/category/amount columns.
    const rows = db
      .prepare(
        "SELECT t.id, t.date, t.payee, t.amount, t.memo, COALESCE(acc.name, '') AS account " +
          "FROM transactions t LEFT JOIN ynab_accounts acc ON acc.id = t.account_id " +
          "WHERE t.category = ? AND t.date >= ? AND t.date <= ? AND t.amount < 0 AND " + CATEGORY_ACTIVITY_PREDICATE + " " +
          "ORDER BY t.date DESC, t.id DESC"
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
