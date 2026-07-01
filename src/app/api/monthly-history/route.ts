import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBudgetMode, getHouseholdSetting } from "@/lib/household";
import { cashFlowForMonth, topExpenseCategories, recentTransactionMonths } from "@/lib/budget-math";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ snapshots: [] }, { status: 401 });

    const db = getDb();

    // Local mode: the YNAB-written monthly_snapshots table is never updated, so derive each recent
    // month's income/expenses straight from the transactions ledger (transfers excluded). Keeps the
    // cash-flow history accurate with no YNAB connection.
    if (getBudgetMode() === "local") {
      const savingGoal = parseFloat(getHouseholdSetting("saving_rate") || "0");
      const snapshots = recentTransactionMonths(db, 6).map((month) => {
        const { income, expenses } = cashFlowForMonth(db, month);
        return {
          month,
          income,
          expenses,
          categories_json: JSON.stringify(topExpenseCategories(db, month)),
          saving_goal: savingGoal,
        };
      });
      console.debug("[monthly-history] Loaded", snapshots.length, "months from transactions (local mode)");
      return NextResponse.json({ snapshots });
    }

    const snapshots = db
      .prepare("SELECT month, income, expenses, categories_json, saving_goal FROM monthly_snapshots ORDER BY month DESC LIMIT 6")
      .all() as { month: string; income: number; expenses: number; categories_json: string; saving_goal: number }[];

    console.debug("[monthly-history] Loaded", snapshots.length, "monthly snapshots");
    return NextResponse.json({ snapshots });
  } catch (error) {
    console.error("[monthly-history] GET error:", error);
    return NextResponse.json({ snapshots: [] }, { status: 500 });
  }
}
