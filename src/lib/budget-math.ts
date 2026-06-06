import { getDb } from "./db";

// Shared budget math so the move/cover endpoint validates against the same available
// balance the budget page shows. Mirrors the carryover model in app/api/budget/route.ts:
// available = carryover + assigned - net activity; positive available rolls forward, negative does not drag.

function ym(monthYM: string, offset: number): string {
  const [y, m] = monthYM.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const ACTIVITY_BY_CAT =
  "SELECT ROUND(SUM(-amount), 2) AS v FROM transactions WHERE category = ? AND date >= ? AND date <= ? " +
  "AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' AND payee NOT LIKE 'Reconciliation%'";

// Actual income for a month = inflows tagged to Ready to Assign (refunds to spending
// categories are NOT income; they reduce that category's activity instead).
export function incomeInflowForMonth(db: ReturnType<typeof getDb>, month: string): number {
  const start = `${month}-01`;
  const [yy, mm] = month.split("-").map(Number);
  const end = `${month}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}`;
  return (db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS v FROM transactions WHERE amount > 0 AND (category = 'Inflow: Ready to Assign' OR category LIKE 'Inflow%') AND date >= ? AND date <= ?"
    )
    .get(start, end) as { v: number }).v || 0;
}

export function assignedForMonth(db: ReturnType<typeof getDb>, month: string): number {
  return (db.prepare("SELECT COALESCE(SUM(budgeted), 0) AS v FROM monthly_category_budgets WHERE month = ?").get(month) as { v: number }).v || 0;
}

// Income and Ready-to-Assign for the viewed month. Ready to Assign is cumulative: prior-month
// leftover rolls forward. Within YNAB's synced range we trust YNAB's own per-month figure
// (adjusted for any local assignment edits). For months after the last synced month we anchor
// on YNAB's last figure and extend the carry-forward month by month so rolling into next month
// stays seamless. With no YNAB at all we use a per-month model with recurring income as a floor.
export function monthBudgetNumbers(
  db: ReturnType<typeof getDb>,
  month: string,
  totalBudgetedThisMonth: number
): { income: number; readyToAssign: number } {
  const round = (n: number) => Math.round(n * 100) / 100;
  const ynabMonth = db
    .prepare("SELECT income, budgeted, to_be_budgeted FROM ynab_month_budget WHERE month = ?")
    .get(month) as { income: number; budgeted: number; to_be_budgeted: number } | undefined;
  if (ynabMonth) {
    const localDivergence = round(totalBudgetedThisMonth - ynabMonth.budgeted);
    return { income: round(ynabMonth.income), readyToAssign: round(ynabMonth.to_be_budgeted - localDivergence) };
  }

  const lastYnab = (db.prepare("SELECT MAX(month) AS m FROM ynab_month_budget WHERE month < ?").get(month) as { m: string | null }).m;
  if (lastYnab) {
    const anchor = db
      .prepare("SELECT budgeted, to_be_budgeted FROM ynab_month_budget WHERE month = ?")
      .get(lastYnab) as { budgeted: number; to_be_budgeted: number };
    let rta = anchor.to_be_budgeted - (assignedForMonth(db, lastYnab) - anchor.budgeted);
    let cursor = ymOffset(lastYnab, 1);
    while (cursor <= month) {
      const asg = cursor === month ? totalBudgetedThisMonth : assignedForMonth(db, cursor);
      rta += incomeInflowForMonth(db, cursor) - asg;
      cursor = ymOffset(cursor, 1);
    }
    return { income: round(incomeInflowForMonth(db, month)), readyToAssign: round(rta) };
  }

  const txIncome = incomeInflowForMonth(db, month);
  const expected = (db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM income_sources WHERE is_active = 1").get() as { v: number }).v || 0;
  const income = round(Math.max(txIncome, expected));
  return { income, readyToAssign: round(income - totalBudgetedThisMonth) };
}

function ymOffset(monthYM: string, offset: number): string {
  const [y, m] = monthYM.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Available balance for one category in a given month.
export function availableForCategory(
  db: ReturnType<typeof getDb>,
  categoryId: number,
  categoryName: string,
  month: string
): number {
  const firstBudget = (db
    .prepare("SELECT MIN(month) AS m FROM monthly_category_budgets WHERE category_id = ?")
    .get(categoryId) as { m: string | null }).m;
  const firstActivity = (db
    .prepare(
      "SELECT MIN(substr(date,1,7)) AS m FROM transactions WHERE category = ? AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' AND payee NOT LIKE 'Reconciliation%'"
    )
    .get(categoryName) as { m: string | null }).m;
  let start = firstBudget || firstActivity;
  if (!start) return 0;
  if (firstBudget && firstActivity && firstActivity < firstBudget) start = firstActivity;

  const budgetStmt = db.prepare("SELECT COALESCE(budgeted,0) AS v FROM monthly_category_budgets WHERE month = ? AND category_id = ?");
  const activityStmt = db.prepare(ACTIVITY_BY_CAT);

  let carry = 0;
  let cursor = start;
  while (cursor <= month) {
    const b = (budgetStmt.get(cursor, categoryId) as { v: number }).v || 0;
    const aStart = `${cursor}-01`;
    const [yy, mm] = cursor.split("-").map(Number);
    const aEnd = `${cursor}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}`;
    const a = (activityStmt.get(categoryName, aStart, aEnd) as { v: number | null }).v || 0;
    const available = Math.round((carry + b - a) * 100) / 100;
    if (cursor === month) return available;
    carry = available > 0 ? available : 0;
    cursor = ym(cursor, 1);
  }
  return Math.round(carry * 100) / 100;
}
