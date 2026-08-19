import { getDb } from "./db";
import { eventBus } from "./event-bus";

// Category and category-target writes, shared by the session-authed /api/categories and /api/targets
// routes and the key-authed /api/v1/categories routes so both mutate identically. A category is
// referenced by name in the transactions ledger, so a rename rewrites that history; a delete either
// reassigns transactions to another category (merging monthly budgets) or removes an empty one.

export interface CategoryCreate {
  name: string;
  group_name?: string;
  color?: string;
}

export function createCategory(p: CategoryCreate): { id: number } | { error: string; code?: number } {
  const name = String(p.name || "").trim();
  if (!name) return { error: "Name required", code: 400 };
  const db = getDb();
  const exists = db.prepare("SELECT id FROM categories WHERE name = ?").get(name) as { id: number } | undefined;
  if (exists) return { error: "Category name already exists", code: 409 };
  const groupName = String(p.group_name || "").trim();
  const color = String(p.color || "").trim();
  const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories").get() as { m: number }).m;
  const r = db.prepare("INSERT INTO categories (name, group_name, sort_order, color) VALUES (?, ?, ?, ?)").run(name, groupName, maxOrder + 1, color);
  console.info("[categories] Created", name, "id:", r.lastInsertRowid);
  eventBus.emit("data:updated", { source: "categories-added" });
  return { id: Number(r.lastInsertRowid) };
}

export interface CategoryUpdate {
  id: number;
  name?: string;
  group_name?: string;
  description?: string;
  color?: string;
  is_active?: boolean;
  sort_order?: number;
  subscription_id?: number | string | null;
  bill_id?: number | string | null;
  debt_account_id?: string | null;
  savings_goal_id?: number | string | null;
  investment_account_id?: string | null;
}

export function updateCategory(p: CategoryUpdate): { found: boolean } | { error: string; code?: number } {
  if (!p.id) return { error: "ID required", code: 400 };
  const db = getDb();
  const cur = db.prepare("SELECT name FROM categories WHERE id = ?").get(p.id) as { name: string } | undefined;
  if (!cur) return { found: false };

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  let renameFrom = "";
  let renameTo = "";
  if (p.name !== undefined) {
    const name = String(p.name).trim();
    if (!name) return { error: "Name cannot be empty", code: 400 };
    const dup = db.prepare("SELECT id FROM categories WHERE name = ? AND id != ?").get(name, p.id) as { id: number } | undefined;
    if (dup) return { error: "Another category already has that name", code: 409 };
    if (cur.name !== name) { renameFrom = cur.name; renameTo = name; }
    updates.push("name = ?"); values.push(name);
  }
  if (p.group_name !== undefined) { updates.push("group_name = ?"); values.push(String(p.group_name).trim()); }
  if (p.description !== undefined) { updates.push("description = ?"); values.push(String(p.description)); }
  if (p.color !== undefined) { updates.push("color = ?"); values.push(String(p.color).trim()); }
  if (p.is_active !== undefined) { updates.push("is_active = ?"); values.push(p.is_active ? 1 : 0); }
  if (p.sort_order !== undefined) { updates.push("sort_order = ?"); values.push(parseInt(String(p.sort_order), 10) || 0); }
  if (p.subscription_id !== undefined || p.bill_id !== undefined || p.debt_account_id !== undefined || p.savings_goal_id !== undefined || p.investment_account_id !== undefined) {
    const sid = p.subscription_id != null ? (parseInt(String(p.subscription_id), 10) || null) : null;
    const bid = p.bill_id != null ? (parseInt(String(p.bill_id), 10) || null) : null;
    const did = p.debt_account_id != null ? String(p.debt_account_id) : null;
    const gid = p.savings_goal_id != null ? (parseInt(String(p.savings_goal_id), 10) || null) : null;
    const iid = p.investment_account_id != null ? String(p.investment_account_id) : null;
    updates.push("subscription_id = ?"); values.push(sid);
    updates.push("bill_id = ?"); values.push(bid);
    updates.push("debt_account_id = ?"); values.push(did);
    updates.push("savings_goal_id = ?"); values.push(gid);
    updates.push("investment_account_id = ?"); values.push(iid);
  }

  if (updates.length === 0) return { found: true };
  updates.push("updated_at = datetime('now')");
  values.push(p.id);
  const apply = db.transaction(() => {
    db.prepare(`UPDATE categories SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    if (renameFrom && renameTo) {
      const res = db.prepare("UPDATE transactions SET category = ? WHERE category = ?").run(renameTo, renameFrom);
      console.info("[categories] Renamed", renameFrom, "->", renameTo, "rewrote", res.changes, "transactions");
    }
  });
  apply();
  console.info("[categories] Updated id", p.id);
  eventBus.emit("data:updated", { source: "categories-updated" });
  return { found: true };
}

export function deleteCategory(p: { id: number; reassign_to?: number | string | null }): { found: boolean; reassigned?: number } | { error: string; code?: number } {
  if (!p.id) return { error: "ID required", code: 400 };
  const db = getDb();
  const cat = db.prepare("SELECT name FROM categories WHERE id = ?").get(p.id) as { name: string } | undefined;
  if (!cat) return { found: false };

  const txCount = (db.prepare("SELECT COUNT(*) AS c FROM transactions WHERE category = ?").get(cat.name) as { c: number }).c;
  let targetName: string | null = null;
  if (txCount > 0) {
    if (p.reassign_to == null) return { error: "A category with transactions needs a reassign target", code: 400 };
    if (Number(p.reassign_to) === Number(p.id)) return { error: "Cannot reassign a category to itself", code: 400 };
    const target = db.prepare("SELECT name FROM categories WHERE id = ?").get(p.reassign_to) as { name: string } | undefined;
    if (!target) return { error: "Reassign target not found", code: 404 };
    targetName = target.name;
  }

  const run = db.transaction(() => {
    if (targetName) {
      const res = db.prepare("UPDATE transactions SET category = ? WHERE category = ?").run(targetName, cat.name);
      console.info("[categories] Reassigned", res.changes, "transactions from", cat.name, "to", targetName);
      const merged = db.prepare(
        `INSERT INTO monthly_category_budgets (month, category_id, budgeted)
         SELECT month, ?, budgeted FROM monthly_category_budgets WHERE category_id = ?
         ON CONFLICT(month, category_id) DO UPDATE SET budgeted = budgeted + excluded.budgeted, updated_at = datetime('now')`
      ).run(p.reassign_to, p.id);
      console.info("[categories] Merged", merged.changes, "monthly budgets into target", targetName);
    }
    db.prepare("DELETE FROM category_targets WHERE category_id = ?").run(p.id);
    db.prepare("DELETE FROM category_snoozes WHERE category_id = ?").run(p.id);
    db.prepare("DELETE FROM category_opening_balances WHERE category_id = ?").run(p.id);
    db.prepare("DELETE FROM monthly_category_budgets WHERE category_id = ?").run(p.id);
    db.prepare("DELETE FROM categories WHERE id = ?").run(p.id);
  });
  run();
  console.info("[categories] Deleted id", p.id, cat.name, "transactions reassigned:", txCount);
  eventBus.emit("data:updated", { source: "categories-deleted" });
  return { found: true, reassigned: txCount };
}

export function reorderCategories(p: { items?: { id: number; group_name: string }[]; order?: number[] }): { ok: boolean } | { error: string; code?: number } {
  const db = getDb();
  if (Array.isArray(p.items)) {
    const items = p.items;
    const stmt = db.prepare("UPDATE categories SET sort_order = ?, group_name = ?, updated_at = datetime('now') WHERE id = ?");
    const tx = db.transaction(() => { items.forEach((it, idx) => stmt.run(idx, String(it.group_name ?? "").trim(), Number(it.id))); });
    tx();
    console.info("[categories] Reordered and regrouped", items.length, "categories");
    eventBus.emit("data:updated", { source: "categories-reordered" });
    return { ok: true };
  }
  if (!Array.isArray(p.order)) return { error: "items or order array required", code: 400 };
  const stmt = db.prepare("UPDATE categories SET sort_order = ?, updated_at = datetime('now') WHERE id = ?");
  const tx = db.transaction(() => { p.order!.forEach((id, idx) => stmt.run(idx, id)); });
  tx();
  console.info("[categories] Reordered", p.order.length, "categories");
  eventBus.emit("data:updated", { source: "categories-reordered" });
  return { ok: true };
}

export interface CategoryTargetSet {
  category_id: number;
  monthly_amount?: number;
  cadence?: string;
  target_date?: string;
  snooze_until_month?: string;
}

export function setCategoryTarget(p: CategoryTargetSet): { ok: boolean } | { error: string; code?: number } {
  const category_id = Number(p.category_id);
  if (!category_id) return { error: "category_id required", code: 400 };
  const db = getDb();
  const existing = db
    .prepare("SELECT id, monthly_amount, COALESCE(cadence, 'monthly') AS cadence, COALESCE(target_date, '') AS target_date, snooze_until_month FROM category_targets WHERE category_id = ?")
    .get(category_id) as { id: number; monthly_amount: number; cadence: string; target_date: string; snooze_until_month: string } | undefined;

  const monthly = p.monthly_amount !== undefined
    ? (isFinite(Number(p.monthly_amount)) ? Math.round(Number(p.monthly_amount) * 100) / 100 : 0)
    : existing?.monthly_amount || 0;
  const allowedCadence = ["daily", "weekly", "monthly", "yearly", "by_date"];
  const cadence = p.cadence !== undefined && allowedCadence.includes(String(p.cadence))
    ? String(p.cadence)
    : existing?.cadence || "monthly";
  const target_date = cadence === "by_date"
    ? (p.target_date !== undefined ? String(p.target_date || "") : existing?.target_date || "")
    : "";
  const snooze = p.snooze_until_month !== undefined
    ? String(p.snooze_until_month || "")
    : existing?.snooze_until_month || "";

  if (existing) {
    db.prepare("UPDATE category_targets SET monthly_amount = ?, cadence = ?, target_date = ?, snooze_until_month = ?, updated_at = datetime('now') WHERE category_id = ?")
      .run(monthly, cadence, target_date, snooze, category_id);
  } else {
    db.prepare("INSERT INTO category_targets (category_id, monthly_amount, cadence, target_date, snooze_until_month) VALUES (?, ?, ?, ?, ?)")
      .run(category_id, monthly, cadence, target_date, snooze);
  }
  console.info("[targets] Set category", category_id, "amount:", monthly, "cadence:", cadence);
  eventBus.emit("data:updated", { source: "targets-changed" });
  return { ok: true };
}

export function clearCategoryTarget(category_id: number): { ok: boolean } | { error: string; code?: number } {
  if (!category_id) return { error: "category_id required", code: 400 };
  const db = getDb();
  db.prepare("DELETE FROM category_targets WHERE category_id = ?").run(category_id);
  console.info("[targets] Cleared target for category", category_id);
  eventBus.emit("data:updated", { source: "targets-cleared" });
  return { ok: true };
}
