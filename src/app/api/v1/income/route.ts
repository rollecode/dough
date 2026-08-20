import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { localDateIso } from "@/lib/date-utils";

interface IncomeRow {
  id: number; name: string; amount: number; expected_day: number;
  is_recurring: number; is_active: number; target_account_id: string | null;
}

// GET /api/v1/income - income sources with this month's received/upcoming status. `upcoming` is true
// for an active source not yet received whose expected_day is still ahead (future income). Pass
// ?month=YYYY-MM to check a specific month (a future month lists all active unreceived as upcoming).
export const GET = apiRoute("read", (request) => {
  const db = getDb();
  const month = resolveMonth(request);
  const rows = db.prepare(
    "SELECT id, name, amount, expected_day, is_recurring, is_active, target_account_id FROM income_sources ORDER BY expected_day ASC"
  ).all() as IncomeRow[];
  const manual = new Map(
    (db.prepare("SELECT income_id, is_received FROM income_manual_status WHERE month = ?").all(month) as { income_id: number; is_received: number }[])
      .map((r) => [r.income_id, !!r.is_received])
  );
  const matched = new Set(
    (db.prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'income' AND month = ?").all(month) as { source_id: number }[])
      .map((r) => r.source_id)
  );
  const isCurrentMonth = month === localDateIso().slice(0, 7);
  const today = new Date().getDate();
  const incomes = rows.map((i) => {
    const received = manual.has(i.id) ? manual.get(i.id)! : matched.has(i.id);
    const upcoming = !!i.is_active && !received && (!isCurrentMonth || i.expected_day >= today);
    return {
      id: i.id, name: i.name, amount: i.amount, expected_day: i.expected_day,
      is_recurring: !!i.is_recurring, is_active: !!i.is_active, target_account_id: i.target_account_id || "",
      received, upcoming,
    };
  });
  return { incomes, count: incomes.length, month };
});
