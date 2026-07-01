import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { buildLocalFinancialData } from "@/lib/local-financial-data";
import { monthBudgetNumbers } from "@/lib/budget-math";

// GET /api/v1/summary - a compact financial snapshot: total balance, this month's income, spending,
// budgeted and Ready to Assign. The one-call overview an assistant reaches for first.
export const GET = apiRoute("read", (request) => {
  const db = getDb();
  const data = buildLocalFinancialData(db);
  const month = resolveMonth(request);
  const { income, readyToAssign } = monthBudgetNumbers(db, month, data.monthBudget.budgeted);
  return {
    month,
    currency: "EUR",
    total_balance: data.summary.totalBalance,
    account_count: data.summary.accounts.length,
    income,
    budgeted: data.monthBudget.budgeted,
    activity: data.monthBudget.activity,
    ready_to_assign: readyToAssign,
    synced_at: data.syncedAt,
  };
});
