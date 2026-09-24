import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { mergePayees, payeeUsage } from "@/lib/payees";

function seed() {
  const db = getDb();
  db.exec("DELETE FROM transactions");
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (1, 'a@example.com', 'x')").run();
  const add = db.prepare("INSERT INTO transactions (user_id, date, amount, payee) VALUES (1, '2026-09-01', -5, ?)");
  ["K-Market Kamppi", "K-Market Kamppi", "K-MARKET KAMPPI 123", "Kmarket kamppi", "Transfer : Savings"].forEach((p) => add.run(p));
}

test("merging moves every spelling onto one name and leaves the rest alone", () => {
  seed();
  assert.equal(mergePayees(["K-MARKET KAMPPI 123", "Kmarket kamppi", "K-Market Kamppi"], "K-Market Kamppi"), 2);
  assert.deepEqual(payeeUsage(10).map((p) => [p.payee, p.uses]), [["K-Market Kamppi", 4]]);
});

test("a rename is a merge of one into a new name", () => {
  seed();
  assert.equal(mergePayees(["Kmarket kamppi"], "  K-Market Kamppi  "), 1);
  assert.equal(mergePayees([], "Anything"), 0);
});
