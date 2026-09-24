import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { NOT_MACHINE_PAYEE, payeeUsage } from "@/lib/payees";

// GET /api/v1/payees - the payees this household actually uses, most used first, each with the
// category it is usually filed under, the account it is usually paid from and what it last cost.
// One call gives a client everything it needs to complete an entry after the first few letters,
// and it keeps working offline, which a per-keystroke lookup could not.
//
// The category is only stated when the history agrees: a payee filed inconsistently gets none
// rather than a misleading guess. Same rule as the web app's own history categorisation.
const MAJORITY = 0.6;

interface UsageRow {
  payee: string;
  category: string;
  account_id: string;
  amount: number;
  date: string;
}

export const GET = apiRoute("read", (request) => {
  const db = getDb();
  const limitRaw = parseInt(new URL(request.url).searchParams.get("limit") || "300", 10);
  const limit = Math.min(1000, Math.max(1, isNaN(limitRaw) ? 300 : limitRaw));

  const payees = payeeUsage(limit);

  if (payees.length === 0) return { payees: [], count: 0 };

  const names = payees.map((p) => p.payee.toLowerCase());
  const placeholders = names.map(() => "?").join(",");
  const usage = db
    .prepare(
      `SELECT payee, COALESCE(category, '') AS category, COALESCE(account_id, '') AS account_id, ` +
        `amount, date FROM transactions WHERE LOWER(payee) IN (${placeholders}) AND ${NOT_MACHINE_PAYEE} ` +
        `ORDER BY date DESC`
    )
    .all(...names) as UsageRow[];

  const byPayee = new Map<string, UsageRow[]>();
  for (const row of usage) {
    const key = row.payee.toLowerCase();
    if (!byPayee.has(key)) byPayee.set(key, []);
    byPayee.get(key)!.push(row);
  }

  const commonest = (values: string[]): string | null => {
    const counts = new Map<string, number>();
    for (const value of values) {
      if (!value || value === "Uncategorized" || value.startsWith("Inflow:")) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) return null;
    const total = ranked.reduce((sum, entry) => sum + entry[1], 0);
    return ranked[0][1] / total >= MAJORITY ? ranked[0][0] : null;
  };

  const enriched = payees.map((p) => {
    const rows = byPayee.get(p.payee.toLowerCase()) ?? [];
    const latest = rows[0];
    return {
      name: p.payee,
      uses: p.uses,
      last_used: p.last_used,
      category: commonest(rows.map((r) => r.category)),
      account_id: commonest(rows.map((r) => r.account_id)),
      last_amount: latest ? Math.round(Math.abs(latest.amount) * 100) / 100 : null,
      // An inflow payee (a salary, a refund) should not be offered as an expense by default.
      inflow: latest ? latest.amount > 0 : false,
    };
  });

  console.debug("[v1/payees] Returning", enriched.length, "payees");
  return { payees: enriched, count: enriched.length };
});
