import { getDb } from "./db";
import { eventBus } from "./event-bus";
import { availableForCategory } from "./budget-math";

// Budget mutations shared by the session-authed budget routes and the key-authed v1 routes:
// moving assigned money between categories (YNAB "cover overspending"/"move money") and snoozing a
// category for a month. Assign and auto-assign already have shared libs (budget/route PUT and
// auto-assign.ts); these fill the rest.

const round = (n: number) => Math.round(n * 100) / 100;

// Move assigned money from one category to another within a month. Total assigned (and Ready to
// Assign) is unchanged. Clamps to the source's available so a move can never manufacture negative
// available. Returns the amount actually moved.
export function moveBudget(p: {
  month: string;
  from_category_id: number;
  to_category_id: number;
  amount: number;
}): { moved: number } | { error: string; available?: number } {
  const month = String(p.month || "");
  const fromId = Number(p.from_category_id);
  const toId = Number(p.to_category_id);
  const amount = round(Number(p.amount));
  if (!month || !fromId || !toId) return { error: "month, from_category_id, to_category_id required" };
  if (fromId === toId) return { error: "Cannot move money to the same category" };
  if (!isFinite(amount) || amount <= 0) return { error: "amount must be a positive number" };

  const db = getDb();
  const nameOf = (id: number): string =>
    (db.prepare("SELECT name FROM categories WHERE id = ?").get(id) as { name: string } | undefined)?.name || "";
  const current = (id: number): number =>
    (db.prepare("SELECT COALESCE(budgeted, 0) AS v FROM monthly_category_budgets WHERE month = ? AND category_id = ?").get(month, id) as { v: number } | undefined)?.v || 0;

  const sourceAvailable = availableForCategory(db, fromId, nameOf(fromId), month);
  const moveAmount = round(Math.min(amount, Math.max(0, sourceAvailable)));
  if (moveAmount <= 0) return { error: "Source category has no available money to move", available: sourceAvailable };

  const upsert = db.prepare(
    "INSERT INTO monthly_category_budgets (month, category_id, budgeted) VALUES (?, ?, ?) " +
      "ON CONFLICT(month, category_id) DO UPDATE SET budgeted = excluded.budgeted, updated_at = datetime('now')"
  );
  db.transaction(() => {
    upsert.run(month, fromId, round(current(fromId) - moveAmount));
    upsert.run(month, toId, round(current(toId) + moveAmount));
  })();
  console.info("[budget/move]", month, "moved", moveAmount, "from cat", fromId, "to cat", toId);
  eventBus.emit("data:updated", { source: "budget-move" });
  return { moved: moveAmount };
}

export function snoozeCategory(category_id: number, month: string): { ok: boolean } | { error: string } {
  if (!category_id || !/^\d{4}-\d{2}$/.test(String(month || ""))) return { error: "category_id and month=YYYY-MM required" };
  getDb().prepare("INSERT OR IGNORE INTO category_snoozes (category_id, month) VALUES (?, ?)").run(category_id, month);
  console.info("[budget/snooze] Snoozed category", category_id, "for", month);
  eventBus.emit("data:updated", { source: "category-snoozed" });
  return { ok: true };
}

export function unsnoozeCategory(category_id: number, month: string): { ok: boolean } | { error: string } {
  if (!category_id || !month) return { error: "category_id and month required" };
  getDb().prepare("DELETE FROM category_snoozes WHERE category_id = ? AND month = ?").run(category_id, month);
  console.info("[budget/snooze] Unsnoozed category", category_id, "for", month);
  eventBus.emit("data:updated", { source: "category-unsnoozed" });
  return { ok: true };
}
