import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getHouseholdSetting } from "@/lib/household";
import { eventBus } from "@/lib/event-bus";

interface CategoryRow {
  id: number;
  name: string;
  group_name: string;
  description: string;
  sort_order: number;
  is_active: number;
}

interface BudgetedRow {
  category_id: number;
  budgeted: number;
}

interface ActivityRow {
  category: string;
  total: number;
}

function ym(monthYM: string, offset: number): string {
  const [y, m] = monthYM.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Sum of activity (negative outflows treated as positive activity amount) per category for a given month
function activityForMonth(db: ReturnType<typeof getDb>, month: string): Map<string, number> {
  const start = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  // Net activity: outflows minus inflows (a refund to a category reduces its spending,
  // matching YNAB). Stored as a positive "spent" figure, so it can go negative on a net refund.
  const rows = db
    .prepare(
      "SELECT category, ROUND(SUM(-amount), 2) AS total " +
        "FROM transactions WHERE date >= ? AND date <= ? AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' AND payee NOT LIKE 'Reconciliation%' GROUP BY category"
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

// Carryover = sum over all prior months of max(0, budgeted - activity)
// (positive available rolls forward, negative does not drag — YNAB default)
function carryoverThrough(db: ReturnType<typeof getDb>, categoryId: number, categoryName: string, month: string): number {
  // Walk back month by month until no earlier budget rows or activity exist for this category
  const firstBudgetRow = db
    .prepare("SELECT MIN(month) AS m FROM monthly_category_budgets WHERE category_id = ?")
    .get(categoryId) as { m: string | null };
  const firstActivityRow = db
    .prepare(
      "SELECT MIN(substr(date, 1, 7)) AS m FROM transactions WHERE category = ? AND amount < 0 AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' AND payee NOT LIKE 'Reconciliation%'"
    )
    .get(categoryName) as { m: string | null };
  let start = firstBudgetRow.m || firstActivityRow.m;
  if (!start) return 0;
  if (firstBudgetRow.m && firstActivityRow.m && firstActivityRow.m < firstBudgetRow.m) start = firstActivityRow.m;

  let carry = 0;
  let cursor = start;
  while (cursor < month) {
    const b = (db
      .prepare("SELECT COALESCE(budgeted, 0) AS v FROM monthly_category_budgets WHERE month = ? AND category_id = ?")
      .get(cursor, categoryId) as { v: number } | undefined)?.v || 0;
    const aStart = `${cursor}-01`;
    const [yy, mm] = cursor.split("-").map(Number);
    const aEnd = `${cursor}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}`;
    const a = (db
      .prepare(
        "SELECT ROUND(SUM(-amount), 2) AS v " +
          "FROM transactions WHERE category = ? AND date >= ? AND date <= ? AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' AND payee NOT LIKE 'Reconciliation%'"
      )
      .get(categoryName, aStart, aEnd) as { v: number | null }).v || 0;
    const available = carry + b - a;
    carry = available > 0 ? available : 0;
    cursor = ym(cursor, 1);
  }
  return Math.round(carry * 100) / 100;
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
      .prepare("SELECT id, name, group_name, COALESCE(description, '') AS description, sort_order, is_active FROM categories ORDER BY group_name, sort_order, name")
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
      .prepare("SELECT category_id, monthly_amount, snooze_until_month FROM category_targets")
      .all() as { category_id: number; monthly_amount: number; snooze_until_month: string }[];
    const targetMap = new Map(targets.map((t) => [t.category_id, t]));

    const snoozedRows = db.prepare("SELECT category_id FROM category_snoozes WHERE month = ?").all(month) as { category_id: number }[];
    const snoozedSet = new Set(snoozedRows.map((r) => r.category_id));

    const rows = cats.map((c) => {
      const b = budgeted.get(c.id) || 0;
      const a = activity.get(c.name) || 0;
      const carry = carryoverThrough(db, c.id, c.name, month);
      const available = Math.round((carry + b - a) * 100) / 100;
      const t = targetMap.get(c.id);
      const target_monthly = t?.monthly_amount || 0;
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
        snooze_until_month,
        target_active,
      };
    });

    // Income & Ready-to-Assign, per the viewed month.
    // In YNAB mode we trust YNAB's own figures for that month: it computes Ready-to-Assign
    // cumulatively (prior-month leftover rolls forward, with all its rules). Computing it
    // from local data alone is wrong here because local assigned history is only seeded for
    // recent months while income history goes back further, which would inflate it massively.
    // We adjust YNAB's number only by any divergence the user introduced by editing this
    // month's assigned amounts locally. In local mode (no YNAB month) we use a per-month
    // model: inflows tagged to Ready to Assign, with recurring income sources as a floor.
    const totalBudgeted = rows.reduce((s, r) => s + r.budgeted, 0);
    const ynabMonth = db
      .prepare("SELECT income, budgeted, to_be_budgeted FROM ynab_month_budget WHERE month = ?")
      .get(month) as { income: number; budgeted: number; to_be_budgeted: number } | undefined;

    let combinedIncome: number;
    let readyToAssign: number;
    if (ynabMonth) {
      combinedIncome = Math.round(ynabMonth.income * 100) / 100;
      const localDivergence = Math.round((totalBudgeted - ynabMonth.budgeted) * 100) / 100;
      readyToAssign = Math.round((ynabMonth.to_be_budgeted - localDivergence) * 100) / 100;
    } else {
      const start = `${month}-01`;
      const [yy, mm] = month.split("-").map(Number);
      const end = `${month}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}`;
      const txIncome = (db
        .prepare(
          "SELECT COALESCE(SUM(amount), 0) AS v FROM transactions WHERE amount > 0 AND (category = 'Inflow: Ready to Assign' OR category LIKE 'Inflow%') AND date >= ? AND date <= ?"
        )
        .get(start, end) as { v: number }).v || 0;
      const expectedIncome = (db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM income_sources WHERE is_active = 1").get() as { v: number }).v || 0;
      combinedIncome = Math.round(Math.max(txIncome, expectedIncome) * 100) / 100;
      readyToAssign = Math.round((combinedIncome - totalBudgeted) * 100) / 100;
    }

    console.debug("[budget] Month", month, "categories", rows.length, "income", combinedIncome, "budgeted", totalBudgeted, "rta", readyToAssign, "mode", ynabMonth ? "ynab" : "local");

    return NextResponse.json({
      month,
      categories: rows,
      income: combinedIncome,
      totalBudgeted: Math.round(totalBudgeted * 100) / 100,
      readyToAssign,
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
