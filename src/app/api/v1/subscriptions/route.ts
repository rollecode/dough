import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";

// GET /api/v1/subscriptions?month=YYYY-MM - recurring subscriptions with their amount, due day and
// whether the month's charge has been paid, resolved as the bills endpoint resolves it.
export const GET = apiRoute("read", (request) => {
  const month = resolveMonth(request);
  const db = getDb();
  const manual = new Map(
    (db.prepare("SELECT bill_id, is_paid FROM bill_manual_status WHERE month = ?").all(month) as {
      bill_id: number; is_paid: number;
    }[]).map((r) => [r.bill_id, !!r.is_paid])
  );
  const matched = new Set(
    (db.prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'subscription' AND month = ?").all(month) as {
      source_id: number;
    }[]).map((r) => r.source_id)
  );
  const rows = db
    .prepare("SELECT id, name, amount, due_day, is_priority FROM subscriptions ORDER BY due_day ASC")
    .all() as { id: number; name: string; amount: number; due_day: number; is_priority: number }[];
  const subscriptions = rows.map((s) => ({
    id: s.id,
    is_paid: manual.has(s.id + 10000) ? manual.get(s.id + 10000)! : matched.has(s.id),
    name: s.name,
    amount: s.amount,
    due_day: s.due_day,
    is_priority: !!s.is_priority,
  }));
  return { subscriptions, count: subscriptions.length, month };
});
