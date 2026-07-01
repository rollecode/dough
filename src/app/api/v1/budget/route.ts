import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { monthBudgetNumbers, availableForCategory, ageOfMoneyData, CATEGORY_ACTIVITY_PREDICATE } from "@/lib/budget-math";

// GET /api/v1/budget?month=YYYY-MM - the month's budget: income, total budgeted, Ready to Assign,
// age of money, and every active category's budgeted / activity / available. Uses the same math as
// the budget page (carry-forward available, mode-aware Ready to Assign).
export const GET = apiRoute("read", (request) => {
  const db = getDb();
  const month = resolveMonth(request);

  const cats = db
    .prepare("SELECT id, name, group_name FROM categories WHERE is_active = 1 ORDER BY group_name, name")
    .all() as { id: number; name: string; group_name: string | null }[];
  const budgetedRows = db
    .prepare("SELECT category_id, budgeted FROM monthly_category_budgets WHERE month = ?")
    .all(month) as { category_id: number; budgeted: number }[];
  const budgetedMap = new Map(budgetedRows.map((r) => [r.category_id, r.budgeted]));
  const activityRows = db
    .prepare(
      "SELECT category, ROUND(SUM(-amount), 2) AS a FROM transactions WHERE date >= ? AND date <= ? AND " +
        CATEGORY_ACTIVITY_PREDICATE +
        " GROUP BY category"
    )
    .all(`${month}-01`, `${month}-31`) as { category: string; a: number }[];
  const activityMap = new Map(activityRows.map((r) => [r.category, r.a]));

  const categories = cats.map((c) => {
    const budgeted = Math.round((budgetedMap.get(c.id) || 0) * 100) / 100;
    const activity = Math.round((activityMap.get(c.name) || 0) * 100) / 100;
    return {
      name: c.name,
      group: c.group_name || "",
      budgeted,
      activity,
      available: availableForCategory(db, c.id, c.name, month),
    };
  });

  const totalBudgeted = Math.round(categories.reduce((s, c) => s + c.budgeted, 0) * 100) / 100;
  const { income, readyToAssign } = monthBudgetNumbers(db, month, totalBudgeted);
  const { ageOfMoney } = ageOfMoneyData(db, month);

  return {
    month,
    currency: "EUR",
    income,
    budgeted: totalBudgeted,
    ready_to_assign: readyToAssign,
    age_of_money: ageOfMoney,
    categories,
  };
});
