import { getDb } from "./db";
import { eventBus } from "./event-bus";

// Income-source write logic, shared by the session-authed /api/income route and the key-authed
// /api/v1/income routes so both create/edit/delete income identically. Server-only (imports getDb).

function currentMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}
function toAmount(v: unknown): number {
  return parseFloat(String(v).replace(",", "."));
}

export interface IncomeCreate {
  name: string;
  amount: number | string;
  expected_day: number;
  is_recurring?: boolean;
  target_account_id?: string;
}

export function createIncome(userId: number, p: IncomeCreate): { id: number } | { error: string } {
  if (!p.name || p.amount === undefined || p.amount === null || p.amount === "" || !p.expected_day) {
    return { error: "name, amount and expected_day required" };
  }
  const db = getDb();
  const r = db.prepare(
    "INSERT INTO income_sources (user_id, name, amount, expected_day, is_recurring, target_account_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(userId, p.name, toAmount(p.amount), p.expected_day, p.is_recurring ? 1 : 0, p.target_account_id || "");
  console.info("[income] Created income source:", p.name, "id:", r.lastInsertRowid);
  eventBus.emit("data:updated", { source: "income-added" });
  return { id: Number(r.lastInsertRowid) };
}

export interface IncomeUpdate {
  id: number;
  name?: string;
  amount?: number | string;
  expected_day?: number;
  is_recurring?: boolean;
  is_active?: boolean;
  target_account_id?: string;
  mark_received?: boolean;
}

// Applies whatever is provided: mark_received writes this month's income_manual_status; the rest
// patch income_sources (an amount change also records income_amount_history). found:false if no id.
export function updateIncome(p: IncomeUpdate): { found: boolean } {
  if (!p.id) return { found: false };
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM income_sources WHERE id = ?").get(p.id);
  if (!exists) return { found: false };

  if (p.mark_received !== undefined) {
    db.prepare("INSERT INTO income_manual_status (income_id, month, is_received) VALUES (?, ?, ?) ON CONFLICT(income_id, month) DO UPDATE SET is_received = excluded.is_received")
      .run(p.id, currentMonth(), p.mark_received ? 1 : 0);
    eventBus.emit("data:updated", { source: "income-received-changed" });
  }

  const updates: string[] = [];
  const values: (string | number)[] = [];
  if (p.name !== undefined) { updates.push("name = ?"); values.push(p.name); }
  if (p.amount !== undefined) {
    const amt = toAmount(p.amount);
    updates.push("amount = ?"); values.push(amt);
    db.prepare("INSERT INTO income_amount_history (income_id, amount, month) VALUES (?, ?, ?) ON CONFLICT(income_id, month) DO UPDATE SET amount = excluded.amount")
      .run(p.id, amt, currentMonth());
  }
  if (p.expected_day !== undefined) { updates.push("expected_day = ?"); values.push(p.expected_day); }
  if (p.is_recurring !== undefined) { updates.push("is_recurring = ?"); values.push(p.is_recurring ? 1 : 0); }
  if (p.is_active !== undefined) { updates.push("is_active = ?"); values.push(p.is_active ? 1 : 0); }
  if (p.target_account_id !== undefined) { updates.push("target_account_id = ?"); values.push(p.target_account_id || ""); }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(p.id);
    db.prepare(`UPDATE income_sources SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    console.info("[income] Updated income source", p.id);
    eventBus.emit("data:updated", { source: "income-updated" });
  }
  return { found: true };
}

export function deleteIncome(id: number): { found: boolean } {
  if (!id) return { found: false };
  const db = getDb();
  const r = db.prepare("DELETE FROM income_sources WHERE id = ?").run(id);
  db.prepare("DELETE FROM income_manual_status WHERE income_id = ?").run(id);
  db.prepare("DELETE FROM income_amount_history WHERE income_id = ?").run(id);
  console.info("[income] Deleted income source", id);
  eventBus.emit("data:updated", { source: "income-deleted" });
  return { found: r.changes > 0 };
}
