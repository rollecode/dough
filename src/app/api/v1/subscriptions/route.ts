import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";

// GET /api/v1/subscriptions - recurring subscriptions with their amount and due day of month.
export const GET = apiRoute("read", () => {
  const rows = getDb()
    .prepare("SELECT id, name, amount, due_day, is_priority FROM subscriptions ORDER BY due_day ASC")
    .all() as { id: number; name: string; amount: number; due_day: number; is_priority: number }[];
  const subscriptions = rows.map((s) => ({
    id: s.id,
    name: s.name,
    amount: s.amount,
    due_day: s.due_day,
    is_priority: !!s.is_priority,
  }));
  return { subscriptions, count: subscriptions.length };
});
