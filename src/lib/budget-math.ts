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
