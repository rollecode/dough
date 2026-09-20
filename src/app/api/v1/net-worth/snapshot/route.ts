import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { localDateIso } from "@/lib/date-utils";
import { eventBus } from "@/lib/event-bus";

// POST /api/v1/net-worth/snapshot (write) - record what everything is worth today, which is what
// the net worth chart is drawn from. Taking one twice in a day overwrites the day's figure.
export const POST = apiRoute("write", () => {
  const db = getDb();
  const accounts = db
    .prepare("SELECT type, balance FROM ynab_accounts WHERE closed = 0")
    .all() as { type: string; balance: number }[];

  const sumType = (type: string) =>
    Math.round(accounts.filter((a) => a.type === type).reduce((s, a) => s + a.balance, 0) * 100) / 100;
  const snapshot = {
    date: localDateIso(),
    checking: sumType("checking"),
    savings: sumType("savings"),
    investments: sumType("otherAsset"),
    debts: sumType("otherDebt"),
    net_worth: Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100,
  };

  db.prepare(
    "INSERT INTO net_worth_snapshots (date, checking, savings, investments, debts, net_worth) " +
      "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET " +
      "checking = excluded.checking, savings = excluded.savings, investments = excluded.investments, " +
      "debts = excluded.debts, net_worth = excluded.net_worth"
  ).run(snapshot.date, snapshot.checking, snapshot.savings, snapshot.investments, snapshot.debts, snapshot.net_worth);

  eventBus.emit("data:updated", { source: "api-v1-net-worth-snapshot" });
  console.info("[api/v1/net-worth/snapshot]", snapshot.date, snapshot.net_worth);
  return { success: true, snapshot };
});
