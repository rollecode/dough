import { getDb } from "./db";
import { eventBus } from "./event-bus";

// Bill write logic, shared by the session-authed /api/bills route and the key-authed /api/v1/bills
// routes so both create/edit/delete bills identically. Server-only (imports getDb); kept out of
// src/lib/bills.ts because that module's cadence helpers are imported by client components.

function currentMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}
function normCadence(v: unknown): "monthly" | "yearly" {
  return v === "yearly" ? "yearly" : "monthly";
}
function clampMonth(v: unknown): number {
  return Math.min(12, Math.max(1, parseInt(String(v), 10) || 1));
}
function toAmount(v: unknown): number {
  return parseFloat(String(v).replace(",", "."));
}

export interface BillCreate {
  name: string;
  amount: number | string;
  due_day: number;
  category?: string;
  cadence?: string;
  due_month?: number;
}

export function createBill(userId: number, p: BillCreate): { id: number } | { error: string } {
  if (!p.name || p.amount === undefined || p.amount === null || p.amount === "" || !p.due_day) {
    return { error: "name, amount and due_day required" };
  }
  const cadence = normCadence(p.cadence);
  const dueMonth = cadence === "yearly" ? clampMonth(p.due_month) : null;
  const db = getDb();
  const r = db.prepare(
    "INSERT INTO recurring_bills (user_id, name, amount, due_day, category, cadence, due_month) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, p.name, toAmount(p.amount), p.due_day, p.category || "", cadence, dueMonth);
  console.info("[bills] Created bill:", p.name, "id:", r.lastInsertRowid);
  eventBus.emit("data:updated", { source: "bill-added" });
  return { id: Number(r.lastInsertRowid) };
}

export interface BillUpdate {
  id: number;
  name?: string;
  amount?: number | string;
  due_day?: number;
  category?: string;
  cadence?: string;
  due_month?: number;
  is_priority?: boolean;
  is_active?: boolean;
  mark_paid?: boolean;
  paid_amount?: number | null;
}

// Applies whatever fields are provided: mark_paid writes the month's bill_manual_status; the rest
// patch recurring_bills (an amount change also records bill_amount_history; a cadence change keeps
// due_month consistent). Returns found:false when the id does not exist.
export function updateBill(p: BillUpdate): { found: boolean } {
  if (!p.id) return { found: false };
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM recurring_bills WHERE id = ?").get(p.id);
  if (!exists) return { found: false };

  if (p.mark_paid !== undefined) {
    const month = currentMonth();
    if (p.mark_paid) {
      db.prepare("INSERT INTO bill_manual_status (bill_id, month, is_paid, paid_amount) VALUES (?, ?, 1, ?) ON CONFLICT(bill_id, month) DO UPDATE SET is_paid = 1, paid_amount = excluded.paid_amount")
        .run(p.id, month, p.paid_amount ?? null);
    } else {
      db.prepare("INSERT INTO bill_manual_status (bill_id, month, is_paid, paid_amount) VALUES (?, ?, 0, NULL) ON CONFLICT(bill_id, month) DO UPDATE SET is_paid = 0, paid_amount = NULL")
        .run(p.id, month);
    }
    eventBus.emit("data:updated", { source: "bill-status-changed" });
  }

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  if (p.name !== undefined) { updates.push("name = ?"); values.push(p.name); }
  if (p.amount !== undefined) {
    const amt = toAmount(p.amount);
    updates.push("amount = ?"); values.push(amt);
    db.prepare("INSERT INTO bill_amount_history (bill_id, amount, month) VALUES (?, ?, ?) ON CONFLICT(bill_id, month) DO UPDATE SET amount = excluded.amount")
      .run(p.id, amt, currentMonth());
  }
  if (p.due_day !== undefined) { updates.push("due_day = ?"); values.push(p.due_day); }
  if (p.category !== undefined) { updates.push("category = ?"); values.push(p.category); }
  if (p.cadence !== undefined) {
    const cadence = normCadence(p.cadence);
    updates.push("cadence = ?"); values.push(cadence);
    updates.push("due_month = ?"); values.push(cadence === "yearly" ? clampMonth(p.due_month) : null);
  } else if (p.due_month !== undefined) {
    updates.push("due_month = ?"); values.push(clampMonth(p.due_month));
  }
  if (p.is_priority !== undefined) { updates.push("is_priority = ?"); values.push(p.is_priority ? 1 : 0); }
  if (p.is_active !== undefined) { updates.push("is_active = ?"); values.push(p.is_active ? 1 : 0); }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(p.id);
    db.prepare(`UPDATE recurring_bills SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    console.info("[bills] Updated bill", p.id);
    eventBus.emit("data:updated", { source: "bill-updated" });
  }
  return { found: true };
}

export function deleteBill(id: number): { found: boolean } {
  if (!id) return { found: false };
  const db = getDb();
  const r = db.prepare("DELETE FROM recurring_bills WHERE id = ?").run(id);
  db.prepare("DELETE FROM bill_manual_status WHERE bill_id = ?").run(id);
  db.prepare("DELETE FROM bill_amount_history WHERE bill_id = ?").run(id);
  db.prepare("DELETE FROM payee_matches WHERE source_type = 'bill' AND source_id = ?").run(id);
  console.info("[bills] Deleted bill", id);
  eventBus.emit("data:updated", { source: "bill-deleted" });
  return { found: r.changes > 0 };
}
