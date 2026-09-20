import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { availableForCategory } from "@/lib/budget-math";

// GET /api/v1/savings-goals - active savings goals with target and derived saved amount. Saved is the
// current available balance of the linked budget category (assigned minus spent, carried forward),
// matching the savings-goals page - never the lifetime sum of assignments.
export const GET = apiRoute("read", (request) => {
  const db = getDb();
  const month = resolveMonth(request);
  const goals = db
    .prepare(
      "SELECT id, name, target_amount, COALESCE(target_date, '') AS target_date, priority, description, " +
        "COALESCE(saved_amount, 0) AS saved_amount, COALESCE(include_in_calculations, 1) AS include_in_calculations " +
        "FROM savings_goals WHERE is_active = 1 ORDER BY created_at ASC"
    )
    .all() as {
      id: number; name: string; target_amount: number; target_date: string; priority: string;
      description: string | null; saved_amount: number; include_in_calculations: number;
    }[];

  const linkRows = db
    .prepare("SELECT id AS category_id, name, savings_goal_id FROM categories WHERE savings_goal_id IS NOT NULL")
    .all() as { category_id: number; name: string; savings_goal_id: number }[];
  const savedByGoal = new Map<number, number>();
  const categoryByGoal = new Map<number, string>();
  for (const r of linkRows) {
    const v = availableForCategory(db, r.category_id, r.name, month);
    savedByGoal.set(r.savings_goal_id, (savedByGoal.get(r.savings_goal_id) || 0) + v);
    categoryByGoal.set(r.savings_goal_id, r.name);
  }

  // What putting the goal within reach costs a month. Without a date it is simply what is left.
  const monthlyNeed = (target: number, saved: number, targetDate: string) => {
    const remaining = target - saved;
    if (remaining <= 0) return 0;
    if (!targetDate) return Math.round(remaining * 100) / 100;
    const due = new Date(targetDate);
    const now = new Date();
    const months = Math.max(
      1,
      (due.getFullYear() - now.getFullYear()) * 12 + due.getMonth() - now.getMonth()
    );
    return Math.round((remaining / months) * 100) / 100;
  };

  // A linked goal derives what is saved from its category's available balance; an unlinked one
  // keeps the figure that was typed into it, which is what the page shows.
  const savedFor = (g: { id: number; saved_amount: number }) =>
    savedByGoal.has(g.id) ? Math.round(savedByGoal.get(g.id)! * 100) / 100 : g.saved_amount;

  const savingsGoals = goals.map((g) => ({
    id: g.id,
    name: g.name,
    target_amount: g.target_amount,
    target_date: g.target_date,
    priority: g.priority,
    description: g.description || "",
    saved_amount: savedFor(g),
    derived: savedByGoal.has(g.id),
    include_in_calculations: !!g.include_in_calculations,
    linked_category_name: categoryByGoal.get(g.id) ?? "",
    monthly_need: monthlyNeed(
      g.target_amount,
      savedFor(g),
      g.target_date
    ),
  }));

  return { savings_goals: savingsGoals, count: savingsGoals.length };
});
