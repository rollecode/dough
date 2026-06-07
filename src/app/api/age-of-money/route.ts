import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

// Lightweight Age of Money for the dashboard: YNAB's own per-month figure (synced into
// ynab_month_budget). Returns the latest value plus the month-by-month history for the chart.
export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = getDb();
    const history = db
      .prepare("SELECT month, age_of_money AS age FROM ynab_month_budget WHERE age_of_money IS NOT NULL ORDER BY month ASC")
      .all() as { month: string; age: number }[];
    const ageOfMoney = history.length > 0 ? history[history.length - 1].age : null;

    return NextResponse.json({ ageOfMoney, history });
  } catch (error) {
    console.error("[age-of-money] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
