import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { getBrandConfig, brandImagePath } from "@/lib/brand-table";

// GET /api/v1/bills?month=YYYY-MM - recurring bills with amount, due day of month, cadence
// (monthly, or yearly on due_month/due_day) and whether the month's charge has been paid, resolved
// the same way the dashboard resolves it: a manual mark wins, otherwise a matched transaction.
export const GET = apiRoute("read", (request) => {
  const month = resolveMonth(request);
  const db = getDb();
  const manual = new Map(
    (db.prepare("SELECT bill_id, is_paid FROM bill_manual_status WHERE month = ?").all(month) as {
      bill_id: number; is_paid: number;
    }[]).map((r) => [r.bill_id, !!r.is_paid])
  );
  const matched = new Set(
    (db.prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'bill' AND month = ?").all(month) as {
      source_id: number;
    }[]).map((r) => r.source_id)
  );
  const patterns = db
    .prepare("SELECT source_id, payee_pattern FROM payee_matches WHERE source_type = 'bill'")
    .all() as { source_id: number; payee_pattern: string }[];
  const patternsById = new Map<number, string[]>();
  for (const p of patterns) {
    patternsById.set(p.source_id, [...(patternsById.get(p.source_id) ?? []), p.payee_pattern]);
  }
  const today = new Date().getDate();

  const rows = db
    .prepare("SELECT id, name, amount, due_day, category, is_active, is_priority, COALESCE(cadence, 'monthly') AS cadence, due_month, COALESCE(interval_months, 1) AS interval_months FROM recurring_bills ORDER BY due_day ASC")
    .all() as { id: number; name: string; amount: number; due_day: number; category: string; is_active: number; is_priority: number; cadence: string; due_month: number | null; interval_months: number }[];
  const bills = rows.map((b) => ({
    id: b.id,
    is_paid: manual.has(b.id) ? manual.get(b.id)! : matched.has(b.id),
    brand_color: getBrandConfig(b.name).color,
    brand_logo: getBrandConfig(b.name).logo,
    brand_image: brandImagePath(b.name),
    is_overdue: !(manual.has(b.id) ? manual.get(b.id)! : matched.has(b.id)) && !!b.is_active && b.due_day < today,
    patterns: patternsById.get(b.id) ?? [],
    name: b.name,
    amount: b.amount,
    due_day: b.due_day,
    category: b.category || "",
    is_active: !!b.is_active,
    is_priority: !!b.is_priority,
    cadence: b.cadence,
    due_month: b.due_month,
    interval_months: b.interval_months,
  }));
  return { bills, count: bills.length, month };
});
