import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import {
  monthBudgetNumbers,
  makeTargetResolver,
  ageOfMoneyData,
  walkCategory,
  CATEGORY_ACTIVITY_PREDICATE,
} from "@/lib/budget-math";
import { savedGroupOrder, sortByGroupOrder } from "@/lib/category-order";

interface CategoryRow {
  id: number;
  name: string;
  group_name: string | null;
  description: string | null;
  budget_excluded: number;
  subscription_id: number | null;
  bill_id: number | null;
  debt_account_id: string | null;
  savings_goal_id: number | null;
  investment_account_id: string | null;
}

// GET /api/v1/budget?month=YYYY-MM - the month's budget: income, total budgeted, Ready to Assign,
// age of money, and every active category with its budgeted / activity / available, what it carries
// in, its target, what it is linked to and whether it is snoozed. Same helpers as the budget page,
// so the two cannot disagree.
export const GET = apiRoute("read", (request) => {
  const db = getDb();
  const month = resolveMonth(request);

  // In the order the budget page shows them, which is the order the reorder endpoint saves.
  const cats = sortByGroupOrder(db
    .prepare(
      "SELECT id, name, group_name, COALESCE(description, '') AS description, budget_excluded, " +
        "subscription_id, bill_id, debt_account_id, savings_goal_id, investment_account_id " +
        "FROM categories WHERE is_active = 1 ORDER BY group_name, sort_order, name"
    )
    .all() as CategoryRow[], savedGroupOrder());
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
  const resolveTarget = makeTargetResolver(db, month);
  const txCounts = new Map(
    (db.prepare("SELECT category AS name, COUNT(*) AS c FROM transactions GROUP BY category").all() as {
      name: string; c: number;
    }[]).map((r) => [r.name, r.c])
  );

  const categories = cats.map((c) => {
    const budgeted = Math.round((budgetedMap.get(c.id) || 0) * 100) / 100;
    const activity = Math.round((activityMap.get(c.name) || 0) * 100) / 100;
    const carryover = walkCategory(db, c.id, c.name, month).carryInto;
    const target = resolveTarget(c, carryover);
    return {
      id: c.id,
      name: c.name,
      group: c.group_name || "",
      description: c.description || "",
      budgeted,
      activity,
      carryover,
      available: Math.round((carryover + budgeted - activity) * 100) / 100,
      budget_excluded: !!c.budget_excluded,
      snoozed: !!target.snoozed,
      target_monthly: target.target_monthly,
      target_amount: target.target_amount,
      target_cadence: target.target_cadence,
      target_date: target.target_date,
      target_active: !!target.target_active,
      snooze_until_month: target.snooze_until_month,
      linked_type: target.linked_type,
      linked_name: target.linked_name,
      subscription_id: c.subscription_id ?? null,
      bill_id: c.bill_id ?? null,
      debt_account_id: c.debt_account_id ?? null,
      savings_goal_id: c.savings_goal_id ?? null,
      investment_account_id: c.investment_account_id ?? null,
      tx_count: txCounts.get(c.name) || 0,
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
