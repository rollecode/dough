import { getDb } from "./db";
import { getBudgetMode } from "./household";
import { localDateIso } from "./date-utils";

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

// Month bounds (first and last day) as YYYY-MM-DD, for date-range queries on a month.
function monthBounds(month: string): { start: string; end: string } {
  const [yy, mm] = month.split("-").map(Number);
  return { start: `${month}-01`, end: `${month}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}` };
}

// Internal transfers between the household's own accounts are neither income nor expense in a
// money-in/money-out view, so the cash-flow figures exclude them: the "Transfer :"/"Starting
// Balance"/"Reconciliation" payees Synci and the edit dialog produce, plus the internal-transfer
// and uncategorised-transfer categories.
const CASHFLOW_REAL =
  "category NOT IN ('Internal transfer', 'Uncategorized') " +
  "AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting Balance%' AND payee NOT LIKE 'Reconciliation%'";

// Cash flow for a month straight from the local ledger: income is every real inflow, expenses every
// real outflow, both excluding internal transfers. This is the money-in/money-out lens the dashboard
// cash-flow chart used to read from YNAB's own month figures; recomputing it locally keeps the chart
// working with no YNAB connection, and it counts uncategorised spending, which is still money out.
export function cashFlowForMonth(db: ReturnType<typeof getDb>, month: string): { income: number; expenses: number } {
  const { start, end } = monthBounds(month);
  const row = db.prepare(
    "SELECT ROUND(COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0), 2) AS income, " +
      "ROUND(-COALESCE(SUM(CASE WHEN amount < 0 THEN amount END), 0), 2) AS expenses " +
      "FROM transactions WHERE date >= ? AND date <= ? AND " + CASHFLOW_REAL
  ).get(start, end) as { income: number; expenses: number };
  return { income: row.income || 0, expenses: row.expenses || 0 };
}

// Top expense categories for a month (name + total spent), for the cash-flow snapshot breakdown.
// An empty category is shown as "Uncategorized" so uncategorised spending is still attributed.
export function topExpenseCategories(db: ReturnType<typeof getDb>, month: string, limit = 10): { name: string; amount: number }[] {
  const { start, end } = monthBounds(month);
  return db.prepare(
    "SELECT COALESCE(NULLIF(category, ''), 'Uncategorized') AS name, ROUND(-SUM(amount), 2) AS amount " +
      "FROM transactions WHERE amount < 0 AND date >= ? AND date <= ? AND " + CASHFLOW_REAL +
      " GROUP BY name ORDER BY amount DESC LIMIT ?"
  ).all(start, end, limit) as { name: string; amount: number }[];
}

// The most recent months that have any transactions, newest first (for the cash-flow history in
// local mode, where the YNAB-written monthly_snapshots table is never updated).
export function recentTransactionMonths(db: ReturnType<typeof getDb>, limit = 6): string[] {
  return (db.prepare(
    "SELECT DISTINCT substr(date, 1, 7) AS month FROM transactions ORDER BY month DESC LIMIT ?"
  ).all(limit) as { month: string }[]).map((r) => r.month);
}

// Per-category budgeted / activity / available for a month from the local categories table and the
// ledger, in the same shape (and YNAB sign convention: activity is negative for spending) the
// dashboard payload used to read from ynab_categories. Used in local mode, where those rows are
// frozen at the cutover and never updated.
export function localMonthCategories(
  db: ReturnType<typeof getDb>,
  month: string
): { name: string; group: string; budgeted: number; activity: number; balance: number }[] {
  const { start, end } = monthBounds(month);
  const cats = db.prepare(
    "SELECT id, name, COALESCE(group_name, '') AS group_name FROM categories WHERE is_active = 1 ORDER BY group_name, sort_order, name"
  ).all() as { id: number; name: string; group_name: string }[];
  const budgeted = new Map((db.prepare(
    "SELECT category_id, budgeted FROM monthly_category_budgets WHERE month = ?"
  ).all(month) as { category_id: number; budgeted: number }[]).map((r) => [r.category_id, r.budgeted]));
  // Raw SUM(amount) keeps YNAB's convention (spending negative, refunds positive); the shared
  // predicate excludes on-budget transfers but counts off-budget ones as activity.
  const activity = new Map((db.prepare(
    "SELECT category, ROUND(SUM(amount), 2) AS a FROM transactions WHERE date >= ? AND date <= ? AND " +
      CATEGORY_ACTIVITY_PREDICATE + " GROUP BY category"
  ).all(start, end) as { category: string; a: number }[]).map((r) => [r.category, r.a]));
  return cats.map((c) => ({
    name: c.name,
    group: c.group_name,
    budgeted: Math.round((budgeted.get(c.id) || 0) * 100) / 100,
    activity: activity.get(c.name) || 0,
    balance: walkCategory(db, c.id, c.name, month).availableAt,
  }));
}

// First month Dough's own feed (Synci import) owns the data, i.e. when YNAB stopped being
// authoritative. In local mode the frozen ynab_month_budget rows from this month on are stale: the
// cutover month is only partially synced, so it under-reports income and pins Ready to Assign. From
// this month on, RTA must come from local inflows, not those rows. Null when no Synci data exists
// (e.g. a manual-only setup), which leaves the historical YNAB behaviour unchanged.
export function firstLocalMonth(db: ReturnType<typeof getDb>): string | null {
  const row = db
    .prepare("SELECT SUBSTR(MIN(date), 1, 7) AS m FROM transactions WHERE ynab_id LIKE 'synci_%'")
    .get() as { m: string | null };
  return row?.m || null;
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

  // In local mode every month from the first locally-fed month on is owned by Dough; its frozen
  // YNAB row is stale, so we ignore it and anchor the carry-forward on the last fully-YNAB month
  // before the local era instead of trusting YNAB's partial income/RTA for the cutover month.
  const localStart = getBudgetMode() === "local" ? firstLocalMonth(db) : null;
  const inLocalEra = localStart != null && month >= localStart;

  let income: number;
  let base: number;
  const ynabMonth = inLocalEra ? undefined : db
    .prepare("SELECT income, budgeted, to_be_budgeted FROM ynab_month_budget WHERE month = ?")
    .get(month) as { income: number; budgeted: number; to_be_budgeted: number } | undefined;
  if (ynabMonth) {
    const localDivergence = round(totalBudgetedThisMonth - ynabMonth.budgeted);
    income = round(ynabMonth.income);
    base = ynabMonth.to_be_budgeted - localDivergence;
  } else {
    // Local-era months anchor before the local era so a stale cutover-month YNAB row is never the
    // anchor; otherwise anchor on the last YNAB month before the viewed month.
    const anchorBefore = inLocalEra ? localStart! : month;
    const lastYnab = (db.prepare("SELECT MAX(month) AS m FROM ynab_month_budget WHERE month < ?").get(anchorBefore) as { m: string | null }).m;
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

  let readyToAssign = round(base - futureCommitted);

  // In local mode, reconcile the CURRENT month's Ready to Assign directly against real account
  // balances (YNAB's golden equation: sum of on-budget balances = Ready to Assign + sum of category
  // available). The income-based carry-forward only counts money booked since the YNAB cutover, so
  // balances accumulated before it (savings built up over years) went untracked - neither in RTA nor
  // in any category. Reconciling against balances surfaces that money as assignable. Past and future
  // months keep the carry-forward, since account balances are only meaningful for "now".
  if (inLocalEra && month === localDateIso().slice(0, 7)) {
    const onBudget = (db.prepare("SELECT COALESCE(SUM(balance), 0) AS v FROM ynab_accounts WHERE on_budget = 1 AND closed = 0").get() as { v: number }).v || 0;
    readyToAssign = round(onBudget - sumCategoryAvailable(db, month) - futureCommitted);
  }

  return { income, readyToAssign };
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

// Age of Money figure plus its monthly history, for the budget page and dashboard. In YNAB mode
// this is YNAB's own per-month figure (synced into ynab_month_budget): the viewed month's value
// when given, else the latest non-null, with the live local runway as a last resort. In local mode
// YNAB no longer syncs, so any stored figure is stale (frozen at the last sync) - use the live
// "money lasts X days" runway and return no history so the chart shows the current stat, not frozen
// data. Centralised here so every consumer (api/budget, api/age-of-money) behaves the same.
export function ageOfMoneyData(db: ReturnType<typeof getDb>, month?: string): { ageOfMoney: number | null; history: { month: string; age: number }[] } {
  if (getBudgetMode() === "local") {
    const ageOfMoney = moneyLastsDays(db);
    console.debug("[budget-math] age of money (local runway):", ageOfMoney);
    return { ageOfMoney, history: [] };
  }
  const history = db
    .prepare("SELECT month, age_of_money AS age FROM ynab_month_budget WHERE age_of_money IS NOT NULL ORDER BY month ASC")
    .all() as { month: string; age: number }[];
  const forMonth = month ? history.find((h) => h.month === month)?.age : undefined;
  const latest = history.length > 0 ? history[history.length - 1].age : undefined;
  const ageOfMoney = forMonth ?? latest ?? moneyLastsDays(db);
  console.debug("[budget-math] age of money (ynab):", ageOfMoney, "months:", history.length);
  return { ageOfMoney, history };
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

// Months from `month` (YYYY-MM) to the target date's month, inclusive of the current month.
// Clamped to a minimum of 1, so a past-due date asks for the full remaining amount now.
export function monthsUntilInclusive(month: string, targetDate: string): number {
  const [cy, cm] = month.split("-").map(Number);
  const ty = Number(targetDate.slice(0, 4));
  const tm = Number(targetDate.slice(5, 7));
  if (!ty || !tm) return 1;
  return Math.max(1, (ty * 12 + tm) - (cy * 12 + cm) + 1);
}

// Per-month contribution for a "save by date" target: the amount still missing (goal minus
// what is already set aside) spread across the months remaining, inclusive of this one. As the
// balance grows month over month the contribution recomputes, reaching the goal on the date.
// Never negative; zero once the goal is reached.
export function byDateMonthlyTarget(goal: number, alreadySaved: number, month: string, targetDate: string): number {
  if (!(goal > 0) || !targetDate) return 0;
  const n = monthsUntilInclusive(month, targetDate);
  const remaining = Math.max(0, goal - alreadySaved);
  return Math.round((remaining / n) * 100) / 100;
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

// Sum of every active category's available balance for a month. Used to reconcile Ready to Assign
// against real account balances (the golden equation: on-budget balance = RTA + sum of available).
export function sumCategoryAvailable(db: ReturnType<typeof getDb>, month: string): number {
  const cats = db.prepare("SELECT id, name FROM categories WHERE is_active = 1").all() as { id: number; name: string }[];
  let sum = 0;
  for (const c of cats) sum += walkCategory(db, c.id, c.name, month).availableAt;
  return Math.round(sum * 100) / 100;
}
