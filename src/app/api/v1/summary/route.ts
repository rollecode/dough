import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { monthBudgetNumbers, localMonthCategories } from "@/lib/budget-math";

// GET /api/v1/summary - a compact financial snapshot: total balance, the month's income, spending,
// budgeted and Ready to Assign. The one-call overview an assistant reaches for first. Every month
// figure is computed for the requested month, so asking for a past month returns that month.
export const GET = apiRoute("read", (request) => {
  const db = getDb();
  const month = resolveMonth(request);

  const accounts = db
    .prepare("SELECT COALESCE(SUM(balance), 0) AS total, COUNT(*) AS n FROM ynab_accounts WHERE closed = 0")
    .get() as { total: number; n: number };

  const categories = localMonthCategories(db, month);
  const budgeted = Math.round(categories.reduce((s, c) => s + c.budgeted, 0) * 100) / 100;
  const activity = Math.round(categories.reduce((s, c) => s + c.activity, 0) * 100) / 100;
  const { income, readyToAssign } = monthBudgetNumbers(db, month, budgeted);

  return {
    month,
    currency: "EUR",
    total_balance: Math.round(accounts.total * 100) / 100,
    account_count: accounts.n,
    income,
    budgeted,
    activity,
    ready_to_assign: readyToAssign,
    synced_at: new Date().toISOString(),
  };
});
