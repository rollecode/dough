import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";

// GET /api/v1/net-worth - current net worth broken down by kind, plus the saved snapshot history.
export const GET = apiRoute("read", () => {
  const db = getDb();
  const accounts = db.prepare("SELECT type, balance FROM ynab_accounts WHERE closed = 0").all() as { type: string; balance: number }[];
  const sumType = (t: string) => Math.round(accounts.filter((a) => a.type === t).reduce((s, a) => s + a.balance, 0) * 100) / 100;
  const current = {
    checking: sumType("checking"),
    savings: sumType("savings"),
    investments: sumType("otherAsset"),
    debts: sumType("otherDebt"),
    net_worth: Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100,
  };
  const history = db
    .prepare("SELECT date, checking, savings, investments, debts, net_worth FROM net_worth_snapshots ORDER BY date ASC")
    .all();
  return { current, history };
});
