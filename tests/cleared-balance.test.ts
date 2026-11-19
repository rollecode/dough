import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { createAccount, ACCOUNT_BALANCES_SQL } from "@/lib/accounts-write";
import { createLocalTransaction } from "@/lib/local-transactions";

test("cleared balance equals the balance, pending rows included", () => {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (1, 'c@example.com', 'x')").run();
  const made = createAccount(1, { name: "Cleared check", balance: 100 });
  assert.ok("id" in made);
  createLocalTransaction(1, { account_id: made.id, amount: 30, date: "2026-11-01", payee_name: "Shop" });
  createLocalTransaction(1, { account_id: made.id, amount: 20, date: "2026-11-02", payee_name: "Hold", cleared: "uncleared" });

  const row = db.prepare(`SELECT ${ACCOUNT_BALANCES_SQL} FROM ynab_accounts WHERE id = ?`).get(made.id);
  assert.deepEqual({ ...(row as object) }, { balance: 50, cleared_balance: 50 });
});
