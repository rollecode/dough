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

  // Money assigned in months further ahead than this view (and beyond YNAB's range) is already
  // earmarked, so it lowers the single global Ready to Assign just like in YNAB. Subtract it once.
  const latestYnab = (db.prepare("SELECT MAX(month) AS m FROM ynab_month_budget").get() as { m: string | null }).m || "";
  const horizon = month > latestYnab ? month : latestYnab;
  const futureCommitted = (db.prepare("SELECT COALESCE(SUM(budgeted), 0) AS v FROM monthly_category_budgets WHERE month > ?").get(horizon) as { v: number }).v || 0;

  let income: number;
  let base: number;
  const ynabMonth = db
    .prepare("SELECT income, budgeted, to_be_budgeted FROM ynab_month_budget WHERE month = ?")
    .get(month) as { income: number; budgeted: number; to_be_budgeted: number } | undefined;
  if (ynabMonth) {
    const localDivergence = round(totalBudgetedThisMonth - ynabMonth.budgeted);
    income = round(ynabMonth.income);
    base = ynabMonth.to_be_budgeted - localDivergence;
  } else {
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
      income = round(incomeInflowForMonth(db, month));
      base = rta;
    } else {
      const txIncome = incomeInflowForMonth(db, month);
      const expected = (db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM income_sources WHERE is_active = 1").get() as { v: number }).v || 0;
      income = round(Math.max(txIncome, expected));
      base = income - totalBudgetedThisMonth;
    }
  }

  return { income, readyToAssign: round(base - futureCommitted) };
}

// "How long your money lasts": cash on hand divided by recent average daily spending. A reliable
// local proxy for Age of Money when YNAB's own figure isn't available (YNAB's exact FIFO method
// can't be faithfully reproduced from local data). Returns null when there's no spending to gauge.
export function moneyLastsDays(db: ReturnType<typeof getDb>): number | null {
  const cash = (db.prepare("SELECT COALESCE(SUM(balance), 0) AS v FROM ynab_accounts WHERE type IN ('checking','savings') AND closed = 0").get() as { v: number }).v || 0;
  const spent = (db
    .prepare("SELECT COALESCE(SUM(-amount), 0) AS v FROM transactions WHERE amount < 0 AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' AND payee NOT LIKE 'Reconciliation%' AND date >= date('now', '-30 days')")
    .get() as { v: number }).v || 0;
  if (spent <= 0 || cash <= 0) return null;
  const perDay = spent / 30;
  return Math.max(0, Math.round(cash / perDay));
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

// Convert a target amount at a given cadence into the amount needed for the viewed month,
// distributing per the cadence (a weekly target funds every week of the month, a yearly
// target spreads across twelve months, etc).
export function monthlyTargetEquivalent(amount: number, cadence: string, month: string): number {
  const round = (n: number) => Math.round(n * 100) / 100;
  switch (cadence) {
    case "daily": return round(amount * daysInMonth(month));
    case "weekly": return round(amount * (daysInMonth(month) / 7));
    case "yearly": return round(amount / 12);
    case "monthly":
    default: return round(amount);
  }
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
