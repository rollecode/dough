import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { getBrandConfig, brandImagePath } from "@/lib/brand-table";

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
  const patterns = db
    .prepare("SELECT source_id, payee_pattern FROM payee_matches WHERE source_type = 'subscription'")
    .all() as { source_id: number; payee_pattern: string }[];
  const patternsById = new Map<number, string[]>();
  for (const p of patterns) {
    patternsById.set(p.source_id, [...(patternsById.get(p.source_id) ?? []), p.payee_pattern]);
  }
  const today = new Date().getDate();

  const rows = db
    .prepare("SELECT id, name, amount, due_day, is_priority, is_active, brand_color, brand_logo FROM subscriptions ORDER BY due_day ASC")
    .all() as {
      id: number; name: string; amount: number; due_day: number; is_priority: number;
      is_active: number; brand_color: string | null; brand_logo: string | null;
    }[];
  const subscriptions = rows.map((s) => {
    const isPaid = manual.has(s.id + 10000) ? manual.get(s.id + 10000)! : matched.has(s.id);
    return {
      id: s.id,
      name: s.name,
      amount: s.amount,
      due_day: s.due_day,
      is_priority: !!s.is_priority,
      is_active: !!s.is_active,
      is_paid: isPaid,
      is_overdue: !isPaid && !!s.is_active && s.due_day < today,
      // The brand as every surface draws it: its colour, its mark, and the bitmap when it has one.
      brand_color: s.brand_color || getBrandConfig(s.name).color,
      brand_logo: s.brand_logo || getBrandConfig(s.name).logo,
      brand_image: brandImagePath(s.name),
      patterns: patternsById.get(s.id) ?? [],
    };
  });
  return { subscriptions, count: subscriptions.length, month };
});
