import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { createLocalTransaction, updateLocalTransaction, deleteLocalTransaction } from "@/lib/local-transactions";
import { updateAccount } from "@/lib/accounts-write";
import { updateInvestment } from "@/lib/investments-write";
import { syncLinkedLegs } from "@/lib/linked-payments";

const db = getDb();
db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (1, 'l@example.com', 'x')").run();
const addAccount = (id: string, name: string, type: string, balance: number) =>
  db.prepare("INSERT INTO ynab_accounts (id, name, type, balance, cleared_balance, on_budget, closed, source) VALUES (?, ?, ?, ?, ?, 0, 0, 'manual')")
    .run(id, name, type, balance, balance);
addAccount("chk", "Checking", "checking", 5000);
addAccount("loan", "Car loan", "otherDebt", -1000);
addAccount("fund", "Index fund", "otherAsset", 2000);
db.prepare("INSERT INTO categories (name, group_name, debt_account_id) VALUES ('Car loan payment', 'Debts', 'loan')").run();
db.prepare("INSERT INTO categories (name, group_name, investment_account_id) VALUES ('Fund saving', 'Savings', 'fund')").run();

const balance = (id: string) => (db.prepare("SELECT balance FROM ynab_accounts WHERE id = ?").get(id) as { balance: number }).balance;
const legs = (id: string) => db.prepare("SELECT date, amount, payee FROM transactions WHERE account_id = ? AND payee NOT LIKE 'Reconciliation%' ORDER BY date").all(id) as { date: string; amount: number; payee: string }[];

test("a payment under a debt's category lowers the debt and follows every edit", () => {
  const made = createLocalTransaction(1, { account_id: "chk", amount: 100, date: "2026-10-01", payee_name: "Lender", category: "Car loan payment" });
  assert.ok("id" in made);
  assert.equal(balance("loan"), -900);
  assert.deepEqual(legs("loan").map((l) => ({ ...l })), [{ date: "2026-10-01", amount: 100, payee: "Transfer : Checking" }]);

  updateLocalTransaction(1, { transaction_id: made.id, amount: 150 });
  assert.equal(balance("loan"), -850);
  assert.equal(legs("loan").length, 1);

  updateLocalTransaction(1, { transaction_id: made.id, category: "Groceries" });
  assert.equal(balance("loan"), -1000);
  assert.equal(legs("loan").length, 0);

  updateLocalTransaction(1, { transaction_id: made.id, category: "Car loan payment" });
  assert.equal(balance("loan"), -850);
  deleteLocalTransaction(1, made.id);
  assert.equal(balance("loan"), -1000);
  assert.equal(legs("loan").length, 0);
});

test("a payment the user already entered on the debt is reused, not doubled", () => {
  db.prepare("INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, account_id) VALUES (1, 'local_manual', '2026-10-04', 80, 'Lender', '', 'loan')").run();
  db.prepare("UPDATE ynab_accounts SET balance = balance + 80 WHERE id = 'loan'").run();
  const made = createLocalTransaction(1, { account_id: "chk", amount: 80, date: "2026-10-03", payee_name: "Lender", category: "Car loan payment" });
  assert.ok("id" in made);
  assert.equal(balance("loan"), -920);
  assert.equal(legs("loan").length, 1);
  deleteLocalTransaction(1, made.id);
});

test("entering a balance reconciles, and payments dated before it are not booked again", () => {
  updateAccount(1, { id: "loan", balance: -700 });
  assert.equal(balance("loan"), -700);
  createLocalTransaction(1, { account_id: "chk", amount: 50, date: "2020-01-01", payee_name: "Lender", category: "Car loan payment" });
  assert.equal(balance("loan"), -700);
  syncLinkedLegs(db, 1);
  assert.equal(balance("loan"), -700);
});

test("a contribution under an investment's category grows its value and what was put in", () => {
  updateInvestment({ ynab_account_id: "fund", init_contributed: 1800 }, 1);
  createLocalTransaction(1, { account_id: "chk", amount: 200, date: "2026-10-05", payee_name: "Broker", category: "Fund saving" });
  assert.equal(balance("fund"), 2200);
  const o = db.prepare("SELECT contributed FROM investment_overrides WHERE ynab_account_id = 'fund'").get() as { contributed: number };
  assert.equal(o.contributed, 2000);
});

test("a new investment value is booked as a dated adjustment", () => {
  updateInvestment({ ynab_account_id: "fund", value: 2500 }, 1);
  assert.equal(balance("fund"), 2500);
  const adj = db.prepare("SELECT amount FROM transactions WHERE account_id = 'fund' AND payee LIKE 'Reconciliation%'").get() as { amount: number };
  assert.equal(adj.amount, 300);
});

test("unlinking a category keeps the payments already booked on the debt", () => {
  const before = balance("loan");
  const made = createLocalTransaction(1, { account_id: "chk", amount: 40, date: "2030-01-01", payee_name: "Lender", category: "Car loan payment" });
  assert.ok("id" in made);
  assert.equal(balance("loan"), before + 40);
  db.prepare("UPDATE categories SET debt_account_id = NULL WHERE name = 'Car loan payment'").run();
  syncLinkedLegs(db, 1);
  assert.equal(balance("loan"), before + 40);
  db.prepare("UPDATE categories SET debt_account_id = 'loan' WHERE name = 'Car loan payment'").run();
});
