import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { transactionSearch } from "@/lib/transaction-search";

function seed() {
  const db = getDb();
  db.exec("DELETE FROM transactions");
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (1, 'a@example.com', 'x')").run();
  db.prepare("INSERT OR IGNORE INTO ynab_accounts (id, name, type, balance) VALUES ('acc', 'Nordea käyttötili', 'checking', 0)").run();
  const add = db.prepare("INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id) VALUES (1, ?, ?, ?, ?, ?, ?, 'acc')");
  add.run("a", "2024-01-05", -12.5, "K-Market", "Ruoka", "maito ja leipä");
  add.run("b", "2026-09-01", -200, "Transfer : Säästötili", "Internal transfer", "");
  add.run("c", "2026-09-02", -8.9, "Alepa", "Ruoka", "");
  return db;
}

function ids(q: string) {
  const { clause, args } = transactionSearch(q);
  return (getDb().prepare(`SELECT t.ynab_id AS id FROM transactions t LEFT JOIN ynab_accounts a ON a.id = t.account_id WHERE ${clause} ORDER BY t.ynab_id`).all(...args) as { id: string }[]).map((r) => r.id);
}

test("text finds payee, category, memo and account, in any year", () => {
  seed();
  assert.deepEqual(ids("k-market"), ["a"]);
  assert.deepEqual(ids("ruoka"), ["a", "c"]);
  assert.deepEqual(ids("leipä"), ["a"]);
  assert.deepEqual(ids("nordea"), ["a", "b", "c"]);
});

test("a number finds the amount, a Finnish comma included", () => {
  seed();
  assert.deepEqual(ids("12,50"), ["a"]);
  assert.deepEqual(ids("200"), ["b"]);
  assert.deepEqual(ids("8.9"), ["c"]);
});
