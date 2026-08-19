// Subscription writes, shared by the session-authed /api/subscriptions route and the key-authed
// /api/v1/subscriptions routes so both create/edit/delete subscriptions identically. Subscriptions
// are monthly; their paid status is tracked in bill_manual_status with bill_id offset by 10000 to
// avoid collision with recurring_bills ids.

import { getDb } from "./db";
import { eventBus } from "./event-bus";

function currentMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}
function toAmount(v: unknown): number {
  return parseFloat(String(v).replace(",", "."));
}

export interface SubscriptionCreate {
  name: string;
  amount: number | string;
  due_day: number;
  brand_color?: string;
  brand_logo?: string;
}

export function createSubscription(p: SubscriptionCreate): { id: number } | { error: string } {
  if (!p.name || p.amount === undefined || p.amount === null || p.amount === "" || !p.due_day) {
    return { error: "name, amount and due_day required" };
  }
  const db = getDb();
  const r = db.prepare(
    "INSERT INTO subscriptions (name, amount, due_day, brand_color, brand_logo) VALUES (?, ?, ?, ?, ?)"
  ).run(p.name, toAmount(p.amount), p.due_day, p.brand_color || "#6366f1", p.brand_logo || "");
  console.info("[subscriptions] Created:", p.name, "id:", r.lastInsertRowid);
  eventBus.emit("data:updated", { source: "subscription-added" });
  return { id: Number(r.lastInsertRowid) };
}

export interface SubscriptionUpdate {
  id: number;
  name?: string;
  amount?: number | string;
  due_day?: number;
  brand_color?: string;
  brand_logo?: string;
  is_priority?: boolean;
  is_active?: boolean;
  mark_paid?: boolean;
}

// Applies whatever fields are provided: mark_paid writes the month's bill_manual_status (bill_id =
// id + 10000, is_paid only); the rest patch the subscriptions row.
export function updateSubscription(p: SubscriptionUpdate): { found: boolean } {
  if (!p.id) return { found: false };
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM subscriptions WHERE id = ?").get(p.id);
  if (!exists) return { found: false };

  if (p.mark_paid !== undefined) {
    const month = currentMonth();
    const offsetId = p.id + 10000;
    db.prepare("INSERT INTO bill_manual_status (bill_id, month, is_paid) VALUES (?, ?, ?) ON CONFLICT(bill_id, month) DO UPDATE SET is_paid = excluded.is_paid")
      .run(offsetId, month, p.mark_paid ? 1 : 0);
    eventBus.emit("data:updated", { source: "subscription-status-changed" });
  }

  const updates: string[] = [];
  const values: (string | number)[] = [];
  if (p.name !== undefined) { updates.push("name = ?"); values.push(p.name); }
  if (p.amount !== undefined) { updates.push("amount = ?"); values.push(toAmount(p.amount)); }
  if (p.due_day !== undefined) { updates.push("due_day = ?"); values.push(p.due_day); }
  if (p.brand_color !== undefined) { updates.push("brand_color = ?"); values.push(p.brand_color); }
  if (p.brand_logo !== undefined) { updates.push("brand_logo = ?"); values.push(p.brand_logo); }
  if (p.is_priority !== undefined) { updates.push("is_priority = ?"); values.push(p.is_priority ? 1 : 0); }
  if (p.is_active !== undefined) { updates.push("is_active = ?"); values.push(p.is_active ? 1 : 0); }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(p.id);
    db.prepare(`UPDATE subscriptions SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    console.info("[subscriptions] Updated", p.id);
    eventBus.emit("data:updated", { source: "subscription-updated" });
  }
  return { found: true };
}

export function deleteSubscription(id: number): { found: boolean } {
  if (!id) return { found: false };
  const db = getDb();
  const r = db.prepare("DELETE FROM subscriptions WHERE id = ?").run(id);
  db.prepare("DELETE FROM payee_matches WHERE source_type = 'subscription' AND source_id = ?").run(id);
  console.info("[subscriptions] Deleted", id);
  eventBus.emit("data:updated", { source: "subscription-deleted" });
  return { found: r.changes > 0 };
}
