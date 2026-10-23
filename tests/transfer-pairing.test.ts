import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { createLocalTransaction, updateLocalTransaction } from "@/lib/local-transactions";
import { INTERNAL_TRANSFER_CATEGORY } from "@/lib/transaction-utils";

const db = getDb();
db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (1, 't@example.com', 'x')").run();
const addAccount = (id: string, name: string, balance: number) =>
  db.prepare("INSERT INTO ynab_accounts (id, name, type, balance, cleared_balance, on_budget, closed, source) VALUES (?, ?, 'checking', ?, ?, 1, 0, 'manual')")
    .run(id, name, balance, balance);

const balance = (id: string) => (db.prepare("SELECT balance FROM ynab_accounts WHERE id = ?").get(id) as { balance: number }).balance;
const legsOn = (account: string, date: string) =>
  db.prepare("SELECT ynab_id, amount, payee FROM transactions WHERE account_id = ? AND date = ? AND category = ? ORDER BY ynab_id")
    .all(account, date, INTERNAL_TRANSFER_CATEGORY) as { ynab_id: string; amount: number; payee: string }[];
const peerOf = (id: string) => (db.prepare("SELECT transfer_peer FROM transactions WHERE ynab_id = ?").get(id) as { transfer_peer: string }).transfer_peer;

// Two counterparts for one leg read as "each source points at a different destination leg".
const assertPaired = (a: string, b: string) => {
  assert.equal(peerOf(a), b);
  assert.equal(peerOf(b), a);
};

const transfer = (from: string, to: string, date: string) => {
  const made = createLocalTransaction(1, { account_id: from, amount: 20, date, category: INTERNAL_TRANSFER_CATEGORY, transfer_account_id: to });
  assert.ok("id" in made);
  return made.id;
};

test("two equal transfers into one account on one day get a destination leg each", () => {
  addAccount("main", "Main", 100);
  addAccount("partner", "Partner", 100);
  addAccount("buffer", "Buffer", 100);

  const fromPartner = transfer("partner", "main", "2026-10-23");
  const fromBuffer = transfer("buffer", "main", "2026-10-23");

  const legs = legsOn("main", "2026-10-23");
  assert.equal(legs.length, 2);
  assert.deepEqual(legs.map((l) => l.payee).sort(), ["Transfer : Buffer", "Transfer : Partner"]);
  assertPaired(fromPartner, legs.find((l) => l.payee === "Transfer : Partner")!.ynab_id);
  assertPaired(fromBuffer, legs.find((l) => l.payee === "Transfer : Buffer")!.ynab_id);
  assert.equal(balance("main"), 140);
  assert.equal(balance("partner"), 80);
  assert.equal(balance("buffer"), 80);

  // Saving either again changes nothing.
  updateLocalTransaction(1, { transaction_id: fromPartner, category: INTERNAL_TRANSFER_CATEGORY, transfer_account_id: "main" });
  updateLocalTransaction(1, { transaction_id: fromBuffer, category: INTERNAL_TRANSFER_CATEGORY, transfer_account_id: "main" });
  assert.equal(legsOn("main", "2026-10-23").length, 2);
  assert.equal(balance("main"), 140);
});

test("a second identical transfer from the same account gets its own leg", () => {
  const first = transfer("partner", "main", "2026-10-24");
  const second = transfer("partner", "main", "2026-10-24");

  const legs = legsOn("main", "2026-10-24");
  assert.equal(legs.length, 2);
  assert.notEqual(peerOf(first), peerOf(second));
  assert.equal(balance("main"), 180);
  assert.equal(balance("partner"), 40);
});

test("marking a leg as a transfer never takes a leg paired to another account", () => {
  addAccount("own", "Own", 0);
  addAccount("spouse", "Spouse", 0);
  addAccount("savings", "Savings", 0);
  const insert = (id: string, account: string, amount: number, payee: string, category: string) =>
    db.prepare("INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, account_id) VALUES (1, ?, '2026-10-23', ?, ?, ?, ?)")
      .run(id, amount, payee, category, account);
  // Stored before pairs were recorded: Savings -> Own is complete, Spouse -> Own arrived only on Spouse.
  insert("synci_own_in", "own", 20, "Transfer : Savings", INTERNAL_TRANSFER_CATEGORY);
  insert("synci_savings_out", "savings", -20, "Transfer : Own", INTERNAL_TRANSFER_CATEGORY);
  insert("synci_spouse_out", "spouse", -20, "Bank transfer", "");
  db.prepare("UPDATE ynab_accounts SET balance = balance + 20 WHERE id = 'own'").run();
  db.prepare("UPDATE ynab_accounts SET balance = balance - 20 WHERE id IN ('savings', 'spouse')").run();

  updateLocalTransaction(1, { transaction_id: "synci_spouse_out", category: INTERNAL_TRANSFER_CATEGORY, transfer_account_id: "own" });
  updateLocalTransaction(1, { transaction_id: "synci_savings_out", category: INTERNAL_TRANSFER_CATEGORY, transfer_account_id: "own" });

  const legs = legsOn("own", "2026-10-23");
  assert.equal(legs.length, 2);
  assertPaired("synci_savings_out", "synci_own_in");
  assert.equal((db.prepare("SELECT payee FROM transactions WHERE ynab_id = 'synci_own_in'").get() as { payee: string }).payee, "Transfer : Savings");
  const spouseLeg = legs.find((l) => l.ynab_id !== "synci_own_in")!;
  assert.equal(spouseLeg.payee, "Transfer : Spouse");
  assertPaired("synci_spouse_out", spouseLeg.ynab_id);
  assert.equal(balance("own"), 40);
  assert.equal(balance("spouse"), -20);
  assert.equal(balance("savings"), -20);
});

test("re-pointing a transfer moves its leg instead of relabelling another one", () => {
  addAccount("dest1", "Dest one", 0);
  addAccount("dest2", "Dest two", 0);
  addAccount("src1", "Source one", 100);
  addAccount("src2", "Source two", 100);

  const one = transfer("src1", "dest1", "2026-10-25");
  const two = transfer("src2", "dest1", "2026-10-25");
  const legOne = peerOf(one);

  updateLocalTransaction(1, { transaction_id: two, category: INTERNAL_TRANSFER_CATEGORY, transfer_account_id: "dest2" });

  assert.equal(legsOn("dest1", "2026-10-25").length, 1);
  assertPaired(one, legOne);
  assert.equal((db.prepare("SELECT payee FROM transactions WHERE ynab_id = ?").get(legOne) as { payee: string }).payee, "Transfer : Source one");
  const moved = legsOn("dest2", "2026-10-25");
  assert.equal(moved.length, 1);
  assert.equal(moved[0].payee, "Transfer : Source two");
  assertPaired(two, moved[0].ynab_id);
  assert.equal(balance("dest1"), 20);
  assert.equal(balance("dest2"), 20);
  assert.equal(balance("src1"), 80);
  assert.equal(balance("src2"), 80);

  // And back again.
  updateLocalTransaction(1, { transaction_id: two, category: INTERNAL_TRANSFER_CATEGORY, transfer_account_id: "dest1" });
  assert.equal(legsOn("dest1", "2026-10-25").length, 2);
  assert.equal(legsOn("dest2", "2026-10-25").length, 0);
  assertPaired(one, legOne);
  assert.equal(balance("dest1"), 40);
  assert.equal(balance("dest2"), 0);
});
