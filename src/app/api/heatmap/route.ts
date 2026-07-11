import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { NOT_BUDGET_EXCLUDED } from "@/lib/budget-math";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ transactions: [] }, { status: 401 });

    const db = getDb();
    const now = new Date();
    // 10 months back
    const since = new Date(now.getFullYear(), now.getMonth() - 9, 1);
    const sinceDate = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-01`;

    const transactions = db.prepare(
      "SELECT date, payee, amount, category FROM transactions WHERE date >= ? AND amount < 0 AND " + NOT_BUDGET_EXCLUDED + " GROUP BY ynab_id ORDER BY date ASC"
    ).all(sinceDate) as { date: string; payee: string; amount: number; category: string }[];

    console.debug("[heatmap] Loaded", transactions.length, "transactions since", sinceDate);
    return NextResponse.json({ transactions });
  } catch (error) {
    console.error("[heatmap] GET error:", error);
    return NextResponse.json({ transactions: [] }, { status: 500 });
  }
}
