import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";

interface DebtRow {
  id: string; name: string; balance: number;
  interest_rate: number | null; minimum_payment: number | null; due_day: number | null;
  original_amount: number | null; notes: string | null; is_priority: number | null;
}

// GET /api/v1/debts (read) - every open otherDebt account with its debt_overrides fields.
export const GET = apiRoute("read", () => {
  const rows = getDb().prepare(
    "SELECT a.id, a.name, a.balance, o.interest_rate, o.minimum_payment, o.due_day, o.original_amount, o.notes, o.is_priority " +
      "FROM ynab_accounts a LEFT JOIN debt_overrides o ON o.ynab_account_id = a.id " +
      "WHERE a.type = 'otherDebt' AND a.closed = 0 ORDER BY COALESCE(o.sort_order, 0), a.name"
  ).all() as DebtRow[];
  const debts = rows.map((d) => ({
    ynab_account_id: d.id,
    name: d.name,
    balance: d.balance,
    interest_rate: d.interest_rate ?? 0,
    minimum_payment: d.minimum_payment ?? 0,
    due_day: d.due_day ?? 0,
    original_amount: d.original_amount ?? 0,
    notes: d.notes ?? "",
    is_priority: !!d.is_priority,
  }));
  return { debts, count: debts.length };
});
