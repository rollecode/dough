import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";

interface InvRow {
  id: string; name: string; balance: number;
  monthly_contribution: number | null; expected_return: number | null;
  notes: string | null; ticker: string | null; contributed: number | null;
}

// GET /api/v1/investments (read) - investment (otherAsset) accounts with their overrides.
export const GET = apiRoute("read", () => {
  const rows = getDb().prepare(
    "SELECT a.id, a.name, a.balance, o.monthly_contribution, o.expected_return, o.notes, o.ticker, o.contributed " +
      "FROM ynab_accounts a LEFT JOIN investment_overrides o ON o.ynab_account_id = a.id " +
      "WHERE a.type = 'otherAsset' AND a.closed = 0 ORDER BY COALESCE(o.sort_order, 0), a.name"
  ).all() as InvRow[];
  const investments = rows.map((r) => ({
    id: r.id,
    name: r.name,
    value: r.balance,
    contributed: r.contributed != null ? r.contributed : r.balance,
    monthly_contribution: r.monthly_contribution ?? 0,
    expected_return: r.expected_return ?? 7,
    notes: r.notes ?? "",
    ticker: r.ticker ?? "",
  }));
  return { investments, count: investments.length };
});
