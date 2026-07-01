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
    .prepare("SELECT id, name, target_amount, COALESCE(target_date, '') AS target_date, priority, description FROM savings_goals WHERE is_active = 1 ORDER BY created_at ASC")
    .all() as { id: number; name: string; target_amount: number; target_date: string; priority: string; description: string | null }[];

  const linkRows = db
    .prepare("SELECT id AS category_id, name, savings_goal_id FROM categories WHERE savings_goal_id IS NOT NULL")
    .all() as { category_id: number; name: string; savings_goal_id: number }[];
  const savedByGoal = new Map<number, number>();
  for (const r of linkRows) {
    const v = availableForCategory(db, r.category_id, r.name, month);
    savedByGoal.set(r.savings_goal_id, (savedByGoal.get(r.savings_goal_id) || 0) + v);
  }

  const savingsGoals = goals.map((g) => ({
    id: g.id,
    name: g.name,
    target_amount: g.target_amount,
    target_date: g.target_date,
    priority: g.priority,
    description: g.description || "",
    saved_amount: savedByGoal.has(g.id) ? Math.round(savedByGoal.get(g.id)! * 100) / 100 : 0,
  }));

  return { savings_goals: savingsGoals, count: savingsGoals.length };
});
