import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

// All transactions for a given month (YYYY-MM), straight from the local table. The dashboard sync
// payload only carries the current month, so the month-navigated transactions view loads each
// viewed month here instead - otherwise older months would show up empty.
export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ transactions: [] }, { status: 401 });

    const url = new URL(request.url);
    const month = url.searchParams.get("month") || "";
    if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ transactions: [] }, { status: 400 });

    const start = `${month}-01`;
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${month}-${String(lastDay).padStart(2, "0")}`;

    const db = getDb();
    // Same-day tie-break on MAX(rowid) DESC (the autoincrement primary key = insertion order), so a
    // just-added transaction lands at the top of its day. The output alias `id` is ynab_id (a random
    // local_<uuid> for new rows), so ordering by it would scatter same-day items arbitrarily.
    const transactions = (db.prepare(
      "SELECT ynab_id as id, date, amount, payee, category, memo, approved, cleared, account_id, COALESCE(split_group, '') AS split_group, COALESCE(budget_excluded, 0) AS budget_excluded " +
        "FROM transactions WHERE date >= ? AND date <= ? GROUP BY ynab_id ORDER BY date DESC, MAX(rowid) DESC"
    ).all(start, end) as { budget_excluded: number }[]).map((t) => ({ ...t, excluded: !!t.budget_excluded }));

    console.debug("[transactions/list] month", month, "->", (transactions as unknown[]).length, "transactions");
    return NextResponse.json({ transactions });
  } catch (error) {
    console.error("[transactions/list] error:", error);
    return NextResponse.json({ transactions: [] }, { status: 500 });
  }
}
