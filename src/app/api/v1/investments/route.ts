import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { calculateProjection } from "@/lib/investment-projection";

interface InvRow {
  id: string; name: string; balance: number;
  monthly_contribution: number | null; expected_return: number | null;
  notes: string | null; ticker: string | null; contributed: number | null;
}

// GET /api/v1/investments (read) - investment (otherAsset) accounts with their overrides.
export const GET = apiRoute("read", (request) => {
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
  // The value-over-time snapshots the investments page charts, and the totals it heads with.
  const progress = getDb()
    .prepare("SELECT date, total_value AS value, total_contributed AS invested FROM investment_progress ORDER BY date ASC")
    .all() as { date: string; value: number; invested: number }[];
  const totalValue = Math.round(investments.reduce((s, i) => s + i.value, 0) * 100) / 100;
  const totalInvested = Math.round(investments.reduce((s, i) => s + i.contributed, 0) * 100) / 100;

  // ?years= is the horizon the page offers; the projection itself is modelled here so both
  // clients draw the same curve.
  const yearsRaw = Number(new URL(request.url).searchParams.get("years"));
  const years = Math.min(50, Math.max(1, Number.isFinite(yearsRaw) && yearsRaw > 0 ? Math.round(yearsRaw) : 20));
  const projection = calculateProjection(
    investments.map((i) => ({
      balance: i.value,
      monthlyContribution: i.monthly_contribution,
      expectedReturn: i.expected_return,
    })),
    years
  );

  return {
    investments,
    count: investments.length,
    projection_years: years,
    projection,
    progress,
    total_value: totalValue,
    total_invested: totalInvested,
    total_profit: Math.round((totalValue - totalInvested) * 100) / 100,
    monthly_contributions: Math.round(
      investments.reduce((s, i) => s + i.monthly_contribution, 0) * 100
    ) / 100,
  };
});
