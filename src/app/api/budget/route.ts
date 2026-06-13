import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getHouseholdSetting } from "@/lib/household";
import { eventBus } from "@/lib/event-bus";
import { monthBudgetNumbers, monthlyTargetEquivalent, byDateMonthlyTarget, moneyLastsDays, walkCategory, CATEGORY_ACTIVITY_PREDICATE } from "@/lib/budget-math";

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
      .prepare("SELECT id, name, group_name, COALESCE(description, '') AS description, sort_order, is_active, subscription_id, bill_id, debt_account_id FROM categories ORDER BY group_name, sort_order, name")
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
    const targets = db
      .prepare("SELECT category_id, monthly_amount, COALESCE(cadence, 'monthly') AS cadence, COALESCE(target_date, '') AS target_date, snooze_until_month FROM category_targets")
      .all() as { category_id: number; monthly_amount: number; cadence: string; target_date: string; snooze_until_month: string }[];
    const targetMap = new Map(targets.map((t) => [t.category_id, t]));
    // Things a category can be linked to (the link supplies the target and display name).
    const subMap = new Map(
      (db.prepare("SELECT id, name, amount FROM subscriptions").all() as { id: number; name: string; amount: number }[]).map((s) => [s.id, s])
    );
    const billMap = new Map(
      (db.prepare("SELECT id, name, amount FROM recurring_bills").all() as { id: number; name: string; amount: number }[]).map((b) => [b.id, b])
    );
    const debtMap = new Map(
      (db.prepare(
        "SELECT a.id, a.name, COALESCE(o.minimum_payment, 0) AS amount FROM ynab_accounts a LEFT JOIN debt_overrides o ON o.ynab_account_id = a.id"
      ).all() as { id: string; name: string; amount: number }[]).map((d) => [d.id, d])
    );

    const snoozedRows = db.prepare("SELECT category_id FROM category_snoozes WHERE month = ?").all(month) as { category_id: number }[];
    const snoozedSet = new Set(snoozedRows.map((r) => r.category_id));

    const rows = cats.map((c) => {
      const b = budgeted.get(c.id) || 0;
      const a = activity.get(c.name) || 0;
      const carry = carryoverThrough(db, c.id, c.name, month);
      const available = Math.round((carry + b - a) * 100) / 100;
      const t = targetMap.get(c.id);
      // A linked subscription/bill/debt supplies the target (its monthly amount) and display
      // name, overriding any manual target. Links are mutually exclusive.
      const linkedSub = c.subscription_id ? subMap.get(c.subscription_id) : undefined;
      const linkedBill = !linkedSub && c.bill_id ? billMap.get(c.bill_id) : undefined;
      const linkedDebt = !linkedSub && !linkedBill && c.debt_account_id ? debtMap.get(c.debt_account_id) : undefined;
      const linked = linkedSub || linkedBill || linkedDebt;
      const linked_type = linkedSub ? "subscription" : linkedBill ? "bill" : linkedDebt ? "debt" : "";
      const target_amount = linked && linked.amount > 0 ? linked.amount : (linked ? 0 : (t?.monthly_amount || 0));
      const target_cadence = linked ? "monthly" : (t?.cadence || "monthly");
      const target_date = linked ? "" : (t?.target_date || "");
      // The amount needed this month. A "by_date" target spreads (goal − already saved) over the
      // months left; every other cadence distributes its per-period amount across the month.
      const target_monthly = target_amount > 0
        ? (target_cadence === "by_date"
            ? byDateMonthlyTarget(target_amount, carry, month, target_date)
            : monthlyTargetEquivalent(target_amount, target_cadence, month))
        : 0;
      const snooze_until_month = t?.snooze_until_month || "";
      const snoozed = snoozedSet.has(c.id);
      // A snoozed-for-the-month category never nudges its target
      const target_active = target_monthly > 0 && !snoozed && (!snooze_until_month || snooze_until_month < month);
      return {
        id: c.id,
        name: c.name,
        group_name: c.group_name,
        description: c.description || "",
        is_active: c.is_active,
        snoozed: snoozed ? 1 : 0,
        budgeted: Math.round(b * 100) / 100,
        activity: Math.round(a * 100) / 100,
        carryover: carry,
        available,
        target_monthly: Math.round(target_monthly * 100) / 100,
        target_amount: Math.round(target_amount * 100) / 100,
        target_cadence,
        target_date,
        snooze_until_month,
        target_active,
        subscription_id: c.subscription_id ?? null,
        bill_id: c.bill_id ?? null,
        debt_account_id: c.debt_account_id ?? null,
        subscription_name: linkedSub?.name || "",
        linked_type,
        linked_name: linked?.name || "",
      };
    });

    // Income & Ready-to-Assign for the viewed month (cumulative carry-forward). See
    // monthBudgetNumbers in lib/budget-math for the model (YNAB authoritative within its
    // synced range, anchored carry-forward for later months, per-month fallback otherwise).
    const totalBudgeted = rows.reduce((s, r) => s + r.budgeted, 0);
    const { income: combinedIncome, readyToAssign } = monthBudgetNumbers(db, month, Math.round(totalBudgeted * 100) / 100);

    // Age of Money: use YNAB's own per-month figure (it accounts for off-budget transfers, which
    // a naive local FIFO cannot). Fall back to the most recent month that has it.
    const aomForMonth = db.prepare("SELECT age_of_money AS v FROM ynab_month_budget WHERE month = ? AND age_of_money IS NOT NULL").get(month) as { v: number } | undefined;
    const aomLatest = aomForMonth ? undefined : (db.prepare("SELECT age_of_money AS v FROM ynab_month_budget WHERE age_of_money IS NOT NULL ORDER BY month DESC LIMIT 1").get() as { v: number } | undefined);
    // Prefer YNAB's own age of money; otherwise fall back to a local "money lasts X days" runway
    const ageOfMoney = aomForMonth?.v ?? aomLatest?.v ?? moneyLastsDays(db);
    const ageOfMoneyHistory = db.prepare("SELECT month, age_of_money AS age FROM ynab_month_budget WHERE age_of_money IS NOT NULL ORDER BY month ASC").all() as { month: string; age: number }[];

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
