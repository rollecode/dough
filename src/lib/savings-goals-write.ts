// Shared savings-goal write logic, used by the session-authed /api/savings-goals route and the
// key-authed /api/v1/savings-goals routes so both create/edit/delete goals identically. A goal can
// link to a budget category (categories.savings_goal_id) via setBudgetLink, which is what ties its
// derived "saved" progress to the budget.
import { getDb } from "./db";
import { eventBus } from "./event-bus";
import { setBudgetLink } from "./budget-links";

function toAmount(v: unknown): number {
  return parseFloat(String(v).replace(",", "."));
}

export interface SavingsGoalCreate {
  name: string;
  target_amount: number | string;
  ynab_category_id?: unknown;
  ynab_category_name?: string;
  target_date?: string;
  description?: string;
}

export function createSavingsGoal(p: SavingsGoalCreate): { id: number } | { error: string } {
  if (!p.name || p.target_amount === undefined || p.target_amount === null || p.target_amount === "") {
    return { error: "name and target_amount required" };
  }
  const db = getDb();
  const r = db.prepare(
    "INSERT INTO savings_goals (name, target_amount, priority, ynab_category_id, ynab_category_name, target_date, description) VALUES (?, ?, 'want', ?, ?, ?, ?)"
  ).run(
    p.name,
    toAmount(p.target_amount),
    p.ynab_category_id || null,
    p.ynab_category_name || null,
    p.target_date || null,
    p.description || ""
  );
  // Tie the goal's progress to the picked budget category (maintains categories.savings_goal_id).
  setBudgetLink(db, "savings_goal", Number(r.lastInsertRowid), p.ynab_category_id);
  console.info("[savings-goals] Created:", p.name, "id:", r.lastInsertRowid);
  eventBus.emit("data:updated", { source: "savings-goal-added" });
  return { id: Number(r.lastInsertRowid) };
}

export interface SavingsGoalUpdate {
  id: number;
  name?: string;
  target_amount?: number | string;
  saved_amount?: number | string;
  ynab_category_id?: unknown;
  ynab_category_name?: string;
  target_date?: string;
  description?: string;
  include_in_calculations?: boolean;
  is_active?: boolean;
}

export function updateSavingsGoal(p: SavingsGoalUpdate): { found: boolean } {
  if (!p.id) return { found: false };
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM savings_goals WHERE id = ?").get(p.id);
  if (!exists) return { found: false };

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  if (p.name !== undefined) { updates.push("name = ?"); values.push(p.name); }
  if (p.target_amount !== undefined) { updates.push("target_amount = ?"); values.push(toAmount(p.target_amount)); }
  if (p.saved_amount !== undefined) { updates.push("saved_amount = ?"); values.push(toAmount(p.saved_amount)); }
  if (p.ynab_category_id !== undefined) { updates.push("ynab_category_id = ?"); values.push((p.ynab_category_id as string | number) || null); }
  if (p.ynab_category_name !== undefined) { updates.push("ynab_category_name = ?"); values.push(p.ynab_category_name || null); }
  if (p.target_date !== undefined) { updates.push("target_date = ?"); values.push(p.target_date || null); }
  if (p.description !== undefined) { updates.push("description = ?"); values.push(p.description || ""); }
  if (p.include_in_calculations !== undefined) { updates.push("include_in_calculations = ?"); values.push(p.include_in_calculations ? 1 : 0); }
  if (p.is_active !== undefined) { updates.push("is_active = ?"); values.push(p.is_active ? 1 : 0); }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(p.id);
    db.prepare(`UPDATE savings_goals SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    // Keep the derivation link in sync: a picked category links progress to the budget, none unlinks.
    if (p.ynab_category_id !== undefined) {
      setBudgetLink(db, "savings_goal", Number(p.id), p.ynab_category_id);
    }
    console.info("[savings-goals] Updated", p.id);
    eventBus.emit("data:updated", { source: "savings-goal-updated" });
  }
  return { found: true };
}

export function deleteSavingsGoal(id: number): { found: boolean } {
  if (!id) return { found: false };
  const db = getDb();
  const r = db.prepare("DELETE FROM savings_goals WHERE id = ?").run(id);
  // Clear the budget link so no category keeps pointing at a goal that no longer exists.
  db.prepare("UPDATE categories SET savings_goal_id = NULL WHERE savings_goal_id = ?").run(id);
  console.info("[savings-goals] Deleted", id);
  eventBus.emit("data:updated", { source: "savings-goal-deleted" });
  return { found: r.changes > 0 };
}
