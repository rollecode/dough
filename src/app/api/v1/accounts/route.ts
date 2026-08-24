import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { getHouseholdSetting } from "@/lib/household";

interface AccountRow {
  id: string;
  name: string;
  type: string;
  balance: number;
  cleared_balance: number;
  on_budget: number;
  closed: number;
}

// GET /api/v1/accounts - every account with its balance. include_closed=1 to also return closed
// accounts (open only by default). budget_excluded marks the accounts the app leaves out of its
// spendable-balance figure, so a caller reading this API sees the same picture the UI does.
export const GET = apiRoute("read", (request) => {
  const db = getDb();
  const includeClosed = new URL(request.url).searchParams.get("include_closed") === "1";
  const excludedRaw = getHouseholdSetting("budget_excluded_accounts");
  let excludedIds: string[] = [];
  try {
    excludedIds = excludedRaw ? JSON.parse(excludedRaw) : [];
  } catch {
    console.warn("[v1/accounts] budget_excluded_accounts is not valid JSON, treating as empty");
  }
  const rows = db
    .prepare(
      "SELECT id, name, type, balance, cleared_balance, on_budget, closed FROM ynab_accounts " +
        (includeClosed ? "" : "WHERE closed = 0 ") +
        "ORDER BY closed, sort_order, name"
    )
    .all() as AccountRow[];
  const accounts = rows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    balance: a.balance,
    cleared_balance: a.cleared_balance,
    on_budget: !!a.on_budget,
    closed: !!a.closed,
    budget_excluded: excludedIds.includes(a.id),
  }));
  return { accounts, count: accounts.length };
});
