import { getDb } from "./db";

// Shared budget math so the move/cover endpoint validates against the same available
// balance the budget page shows. Mirrors the carryover model in app/api/budget/route.ts:
// available = carryover + assigned - net activity; positive available rolls forward, negative does not drag.

function ym(monthYM: string, offset: number): string {
  const [y, m] = monthYM.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// A category's activity is every transaction in that category EXCEPT transfers between on-budget
// accounts (budget-internal moves that neither spend nor save). A transfer to an OFF-budget
// (tracking) account — investing, debt paydown — IS activity, and so are reconciliation/balance
// adjustments categorised to it, matching YNAB. The counterparty account is the name after
// "Transfer : " (11 chars), matched to ynab_accounts; an unknown counterparty counts as activity.
export const CATEGORY_ACTIVITY_PREDICATE =
  "(payee NOT LIKE 'Transfer%' OR EXISTS (SELECT 1 FROM ynab_accounts a WHERE a.name = SUBSTR(payee, 12) AND a.on_budget = 0))";

// Opening balance anchor for a category: the carry-in available as of anchor_month, seeded
// from YNAB at cutover (see seedOpeningBalancesFromYnab). When present, the carryover walk
// starts at anchor_month with this balance instead of zero, so balances accumulated before
// the synced window are preserved. Returns null when no anchor exists (e.g. local-only category).
export function getOpeningAnchor(
  db: ReturnType<typeof getDb>,
  categoryId: number
): { month: string; balance: number } | null {
  try {
    const row = db
      .prepare("SELECT anchor_month AS month, balance FROM category_opening_balances WHERE category_id = ?")
      .get(categoryId) as { month: string; balance: number } | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

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

// Per-month budgeted + activity for one category, fetched in two bulk queries instead of one
// pair per month, so a multi-year carryover replay stays fast. activity uses
// CATEGORY_ACTIVITY_PREDICATE (normal spending + off-budget transfers).
const BUDGET_BY_MONTH = "SELECT month, COALESCE(budgeted,0) AS b FROM monthly_category_budgets WHERE category_id = ? ORDER BY month";
const ACTIVITY_BY_MONTH =
  "SELECT substr(date,1,7) AS month, ROUND(SUM(-amount),2) AS a FROM transactions WHERE category = ? AND " +
  CATEGORY_ACTIVITY_PREDICATE + " GROUP BY substr(date,1,7)";

// Replay a category's monthly budgeted/activity to get its available at `month` and the carry
// that rolled into `month`. Positive available rolls forward, negative resets to 0 (YNAB default).
// An opening anchor, when present, starts the walk at its month with the carry-in balance so
// pre-cutover history (for shallow syncs) is preserved without replaying it.
export function walkCategory(
  db: ReturnType<typeof getDb>,
  categoryId: number,
  categoryName: string,
  month: string
): { availableAt: number; carryInto: number } {
  const budRows = db.prepare(BUDGET_BY_MONTH).all(categoryId) as { month: string; b: number }[];
  const actRows = db.prepare(ACTIVITY_BY_MONTH).all(categoryName) as { month: string; a: number }[];
  const bMap = new Map(budRows.map((r) => [r.month, r.b]));
  const aMap = new Map(actRows.map((r) => [r.month, r.a]));

  const firstBudget = budRows.length ? budRows[0].month : null;
  let firstActivity: string | null = null;
  for (const r of actRows) if (firstActivity === null || r.month < firstActivity) firstActivity = r.month;
  let start = firstBudget || firstActivity;
  if (!start) return { availableAt: 0, carryInto: 0 };
  if (firstBudget && firstActivity && firstActivity < firstBudget) start = firstActivity;

  let carry = 0;
  let cursor = start;
  const anchor = getOpeningAnchor(db, categoryId);
  if (anchor && anchor.month <= month) {
    cursor = anchor.month;
    carry = anchor.balance;
  }
  while (cursor <= month) {
    const b = bMap.get(cursor) || 0;
    const a = aMap.get(cursor) || 0;
    const available = Math.round((carry + b - a) * 100) / 100;
    if (cursor === month) return { availableAt: available, carryInto: carry };
    carry = available > 0 ? available : 0;
    cursor = ym(cursor, 1);
  }
  return { availableAt: Math.round(carry * 100) / 100, carryInto: carry };
}

// Available balance for one category in a given month.
export function availableForCategory(
  db: ReturnType<typeof getDb>,
  categoryId: number,
  categoryName: string,
  month: string
): number {
  return walkCategory(db, categoryId, categoryName, month).availableAt;
}
