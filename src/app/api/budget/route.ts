import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getHouseholdSetting } from "@/lib/household";
import { eventBus } from "@/lib/event-bus";
import { monthBudgetNumbers, makeTargetResolver, ageOfMoneyData, walkCategory, CATEGORY_ACTIVITY_PREDICATE } from "@/lib/budget-math";

interface CategoryRow {
  id: number;
  name: string;
  group_name: string;
  description: string;
  sort_order: number;
  is_active: number;
  subscription_id: number | null;
  bill_id: number | null;
  debt_account_id: string | null;
  savings_goal_id: number | null;
  investment_account_id: string | null;
}

interface BudgetedRow {
  category_id: number;
  budgeted: number;
}

interface ActivityRow {
  category: string;
  total: number;
}

// Sum of activity (negative outflows treated as positive activity amount) per category for a given month
function activityForMonth(db: ReturnType<typeof getDb>, month: string): Map<string, number> {
  const start = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  // Net activity: outflows minus inflows (a refund to a category reduces its spending,
  // matching YNAB). Stored as a positive "spent" figure, so it can go negative on a net refund.
  // Uses the shared predicate so off-budget transfers (investing, debt paydown) count as activity.
  const rows = db
    .prepare(
      "SELECT category, ROUND(SUM(-amount), 2) AS total " +
        "FROM transactions WHERE date >= ? AND date <= ? AND " + CATEGORY_ACTIVITY_PREDICATE + " GROUP BY category"
    )
    .all(start, end) as ActivityRow[];
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.category, r.total);
  return map;
}

function budgetedForMonth(db: ReturnType<typeof getDb>, month: string): Map<number, number> {
  const rows = db
    .prepare("SELECT category_id, budgeted FROM monthly_category_budgets WHERE month = ?")
    .all(month) as BudgetedRow[];
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.category_id, r.budgeted);
  return map;
}

// Carryover = the available balance that rolls into `month` (positive rolls forward, negative
// resets to 0 — YNAB default). Delegates to the shared bulk-query walk so a multi-year history
// replays without a query per month.
function carryoverThrough(db: ReturnType<typeof getDb>, categoryId: number, categoryName: string, month: string): number {
  return walkCategory(db, categoryId, categoryName, month).carryInto;
}

export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const url = new URL(request.url);
    const now = new Date();
    const month = url.searchParams.get("month") || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const db = getDb();
    const cats = db
      .prepare("SELECT id, name, group_name, COALESCE(description, '') AS description, sort_order, is_active, subscription_id, bill_id, debt_account_id, savings_goal_id, investment_account_id FROM categories ORDER BY group_name, sort_order, name")
      .all() as CategoryRow[];

    // Apply saved group ordering (stable sort keeps within-group sort_order from the query)
    let groupOrder: string[] = [];
    try { groupOrder = JSON.parse(getHouseholdSetting("budget_group_order") || "[]"); } catch {}
    if (Array.isArray(groupOrder) && groupOrder.length > 0) {
      const gi = (name: string) => {
        const i = groupOrder.indexOf(name || "");
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      cats.sort((a, b) => gi(a.group_name) - gi(b.group_name));
    }

    const budgeted = budgetedForMonth(db, month);
    const activity = activityForMonth(db, month);
    // Resolve each category's effective target (manual category_targets OR a link to a
    // subscription/bill/debt/investment/savings goal). Shared with auto-assign so "fund to targets"
    // funds exactly the targets shown here. See makeTargetResolver in lib/budget-math.
    const resolveTarget = makeTargetResolver(db, month);

    // Lifetime transaction count per category (matched by name, like the rest of the budget), so the
    // delete flow knows when it must reassign a category's transactions before removing it.
    const txCountRows = db.prepare("SELECT category AS name, COUNT(*) AS c FROM transactions GROUP BY category").all() as { name: string; c: number }[];
    const txCountMap = new Map(txCountRows.map((r) => [r.name, r.c]));

    const rows = cats.map((c) => {
      const b = budgeted.get(c.id) || 0;
      const a = activity.get(c.name) || 0;
      const carry = carryoverThrough(db, c.id, c.name, month);
      const available = Math.round((carry + b - a) * 100) / 100;
      const t = resolveTarget(c, carry);
      return {
        id: c.id,
        name: c.name,
        group_name: c.group_name,
        description: c.description || "",
        is_active: c.is_active,
        snoozed: t.snoozed ? 1 : 0,
        budgeted: Math.round(b * 100) / 100,
        activity: Math.round(a * 100) / 100,
        carryover: carry,
        available,
        target_monthly: t.target_monthly,
        target_amount: t.target_amount,
        target_cadence: t.target_cadence,
        target_date: t.target_date,
        snooze_until_month: t.snooze_until_month,
        target_active: t.target_active,
        subscription_id: c.subscription_id ?? null,
        bill_id: c.bill_id ?? null,
        debt_account_id: c.debt_account_id ?? null,
        savings_goal_id: c.savings_goal_id ?? null,
        investment_account_id: c.investment_account_id ?? null,
        subscription_name: t.subscription_name,
        linked_type: t.linked_type,
        linked_name: t.linked_name,
        tx_count: txCountMap.get(c.name) || 0,
      };
    });

    // Income & Ready-to-Assign for the viewed month (cumulative carry-forward). See
    // monthBudgetNumbers in lib/budget-math for the model (YNAB authoritative within its
    // synced range, anchored carry-forward for later months, per-month fallback otherwise).
    const totalBudgeted = rows.reduce((s, r) => s + r.budgeted, 0);
    const { income: combinedIncome, readyToAssign } = monthBudgetNumbers(db, month, Math.round(totalBudgeted * 100) / 100);

    // Age of Money: YNAB's own per-month figure in YNAB mode, the live local runway in local mode
    // (where the stored YNAB figure is stale). Shared mode-aware logic with the age-of-money route.
    const { ageOfMoney, history: ageOfMoneyHistory } = ageOfMoneyData(db, month);

    console.debug("[budget] Month", month, "categories", rows.length, "income", combinedIncome, "budgeted", totalBudgeted, "rta", readyToAssign, "aom", ageOfMoney);

    return NextResponse.json({
      month,
      categories: rows,
      income: combinedIncome,
      totalBudgeted: Math.round(totalBudgeted * 100) / 100,
      readyToAssign,
      ageOfMoney,
      ageOfMoneyHistory,
    });
  } catch (error) {
    console.error("[budget] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const month = String(body.month || "");
    const category_id = Number(body.category_id);
    const budgeted = Number(body.budgeted);
    if (!month || !category_id || !isFinite(budgeted)) {
      return NextResponse.json({ error: "month, category_id, budgeted required" }, { status: 400 });
    }

    const db = getDb();
    db.prepare(
      "INSERT INTO monthly_category_budgets (month, category_id, budgeted) VALUES (?, ?, ?) " +
        "ON CONFLICT(month, category_id) DO UPDATE SET budgeted = excluded.budgeted, updated_at = datetime('now')"
    ).run(month, category_id, Math.round(budgeted * 100) / 100);

    console.info("[budget] Set", month, "cat", category_id, "to", budgeted);
    eventBus.emit("data:updated", { source: "budget-changed" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[budget] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
