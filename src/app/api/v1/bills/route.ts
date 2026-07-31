import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";

// GET /api/v1/bills - recurring bills with amount, due day of month, and cadence
// (monthly, or yearly on due_month/due_day).
export const GET = apiRoute("read", () => {
  const rows = getDb()
    .prepare("SELECT id, name, amount, due_day, category, is_active, is_priority, COALESCE(cadence, 'monthly') AS cadence, due_month FROM recurring_bills ORDER BY due_day ASC")
    .all() as { id: number; name: string; amount: number; due_day: number; category: string; is_active: number; is_priority: number; cadence: string; due_month: number | null }[];
  const bills = rows.map((b) => ({
    id: b.id,
    name: b.name,
    amount: b.amount,
    due_day: b.due_day,
    category: b.category || "",
    is_active: !!b.is_active,
    is_priority: !!b.is_priority,
    cadence: b.cadence,
    due_month: b.due_month,
  }));
  return { bills, count: bills.length };
});
