import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { localDateIso } from "@/lib/date-utils";
import { netWorthHistory, addLegsToSnapshots } from "@/lib/net-worth-history";

const db = getDb();
db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (1, 'n@example.com', 'x')").run();
db.prepare("INSERT INTO ynab_accounts (id, name, type, balance) VALUES ('nw-chk', 'Checking', 'checking', 900), ('nw-loan', 'Loan', 'otherDebt', -400)").run();
const snap = db.prepare("INSERT INTO net_worth_snapshots (date, checking, savings, investments, debts, net_worth, created_at) VALUES (?, 900, 0, 0, -500, 400, '2026-01-01 00:00:00')");
snap.run("2026-05-01");
snap.run("2026-06-01");

test("the chart ends at today's live balances, not the last saved day", () => {
  const history = netWorthHistory(db);
  const last = history[history.length - 1];
  assert.equal(last.date, localDateIso());
  assert.equal(last.net_worth, 500);
  assert.equal(last.debts, -400);
});

test("a payment booked late lowers the debt in every saved day from its date on", () => {
  db.prepare("INSERT INTO transactions (user_id, ynab_id, date, amount, payee, account_id, created_at) VALUES (1, 'link_x', '2026-05-15', 100, 'Transfer : Checking', 'nw-loan', '2026-02-01 00:00:00')").run();
  addLegsToSnapshots(db, "2026-02-01 00:00:00");
  const rows = db.prepare("SELECT date, debts, net_worth FROM net_worth_snapshots WHERE date IN ('2026-05-01', '2026-06-01') ORDER BY date").all();
  assert.deepEqual(rows.map((r) => ({ ...(r as object) })), [
    { date: "2026-05-01", debts: -500, net_worth: 400 },
    { date: "2026-06-01", debts: -400, net_worth: 500 },
  ]);
});
