import { getDb } from "./db";
import { localDateIso } from "./date-utils";

// Net worth over time is drawn from one saved row per day. The saved rows can lag the balances (no
// snapshot yet today, or a payment booked after the day was saved), so the history always ends at
// what the accounts hold right now, and a payment booked late is written back into the saved days.

type Db = ReturnType<typeof getDb>;

export interface NetWorthPoint {
  date: string;
  checking: number;
  savings: number;
  investments: number;
  debts: number;
  net_worth: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function liveNetWorth(db: Db): NetWorthPoint {
  const accounts = db.prepare("SELECT type, balance FROM ynab_accounts WHERE closed = 0").all() as { type: string; balance: number }[];
  const sumType = (t: string) => round(accounts.filter((a) => a.type === t).reduce((s, a) => s + a.balance, 0));
  return {
    date: localDateIso(),
    checking: sumType("checking"),
    savings: sumType("savings"),
    investments: sumType("otherAsset"),
    debts: sumType("otherDebt"),
    net_worth: round(accounts.reduce((s, a) => s + a.balance, 0)),
  };
}

export function netWorthHistory(db: Db): NetWorthPoint[] {
  const saved = db
    .prepare("SELECT date, checking, savings, investments, debts, net_worth FROM net_worth_snapshots ORDER BY date ASC")
    .all() as NetWorthPoint[];
  const live = liveNetWorth(db);
  return [...saved.filter((s) => s.date < live.date), live];
}

// Linked debt and investment payments created at or after `createdSince` are added to every saved
// day on or after the payment's date that was saved before the payment was booked.
export function addLegsToSnapshots(db: Db, createdSince: string): number {
  const res = db.prepare(
    "UPDATE net_worth_snapshots SET " +
      "debts = ROUND(debts + (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t JOIN ynab_accounts a ON a.id = t.account_id " +
      "  WHERE t.ynab_id LIKE 'link_%' AND a.type = 'otherDebt' AND t.created_at >= ? AND t.date <= net_worth_snapshots.date AND t.created_at > net_worth_snapshots.created_at), 2), " +
      "investments = ROUND(investments + (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t JOIN ynab_accounts a ON a.id = t.account_id " +
      "  WHERE t.ynab_id LIKE 'link_%' AND a.type = 'otherAsset' AND t.created_at >= ? AND t.date <= net_worth_snapshots.date AND t.created_at > net_worth_snapshots.created_at), 2), " +
      "net_worth = ROUND(net_worth + (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t JOIN ynab_accounts a ON a.id = t.account_id " +
      "  WHERE t.ynab_id LIKE 'link_%' AND a.type IN ('otherDebt', 'otherAsset') AND t.created_at >= ? AND t.date <= net_worth_snapshots.date AND t.created_at > net_worth_snapshots.created_at), 2) " +
      "WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.ynab_id LIKE 'link_%' AND t.created_at >= ? AND t.date <= net_worth_snapshots.date AND t.created_at > net_worth_snapshots.created_at)"
  ).run(createdSince, createdSince, createdSince, createdSince);
  console.info("[net-worth-history] Wrote late payments into", res.changes, "saved days");
  return res.changes;
}
