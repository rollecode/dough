import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { NOT_BUDGET_EXCLUDED } from "@/lib/budget-math";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ trends: [] }, { status: 401 });

    const db = getDb();
    const now = new Date();

    // Calendar month comparison: this month vs last month
    const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStart = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}-01`;
    const lastMonthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    // This month by category (actual spending so far)
    const recent = db.prepare(
      "SELECT category, SUM(ABS(amount)) as total FROM transactions WHERE date >= ? AND amount < 0 AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting Balance%' AND payee NOT LIKE 'Reconciliation%' AND category != 'Uncategorized' AND category != 'Inflow: Ready to Assign' AND category != '' AND " + NOT_BUDGET_EXCLUDED + " GROUP BY category"
    ).all(thisMonthStart) as { category: string; total: number }[];

    // Last month same period (day 1 to same day of month) for fair comparison
    const dayOfMonth = now.getDate();
    const lastMonthSameDay = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), dayOfMonth + 1);
    const lastMonthSameDayStr = `${lastMonthSameDay.getFullYear()}-${String(lastMonthSameDay.getMonth() + 1).padStart(2, "0")}-${String(lastMonthSameDay.getDate()).padStart(2, "0")}`;

    const previous = db.prepare(
      "SELECT category, SUM(ABS(amount)) as total FROM transactions WHERE date >= ? AND date < ? AND amount < 0 AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting Balance%' AND payee NOT LIKE 'Reconciliation%' AND category != 'Uncategorized' AND category != 'Inflow: Ready to Assign' AND category != '' AND " + NOT_BUDGET_EXCLUDED + " GROUP BY category"
    ).all(lastMonthStart, lastMonthSameDayStr) as { category: string; total: number }[];

    const recentMap = new Map(recent.map((r) => [r.category, r.total]));
    const prevMap = new Map(previous.map((r) => [r.category, r.total]));

    const allCategories = new Set([...recentMap.keys(), ...prevMap.keys()]);
    const trends = [...allCategories]
      .map((c) => ({
        category: c,
        thisMonth: Math.round((recentMap.get(c) || 0) * 100) / 100,
        lastMonth: Math.round((prevMap.get(c) || 0) * 100) / 100,
      }))
      .filter((t) => t.thisMonth > 0 || t.lastMonth > 0);

    console.debug("[trends] Loaded", trends.length, "category trends (day", dayOfMonth, "comparison)");
    return NextResponse.json({ trends });
  } catch (error) {
    console.error("[trends] Error:", error);
    return NextResponse.json({ trends: [] }, { status: 500 });
  }
}
