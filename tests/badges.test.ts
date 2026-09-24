import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { setHouseholdSetting } from "@/lib/household";
import { transactionsUnread, markTransactionsSeen, chatUnread, markChatSeen } from "@/lib/badges";

function users() {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (1, 'a@example.com', 'x')").run();
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (2, 'b@example.com', 'x')").run();
  return db;
}

test("a hand-added expense lights transactions until they are seen", () => {
  const db = users();
  assert.equal(transactionsUnread(db, 1), 0);
  db.prepare("UPDATE transactions_last_seen SET seen_at = datetime('now', '-1 hour') WHERE user_id = 1").run();
  setHouseholdSetting("last_transaction_added", new Date().toISOString());
  assert.equal(transactionsUnread(db, 1), 1);
  markTransactionsSeen(db, 1);
  assert.equal(transactionsUnread(db, 1), 0);
});

test("chat counts only other people's messages since last seen", () => {
  const db = users();
  const add = db.prepare("INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'user', 'hi')");
  add.run(2); add.run(2); add.run(1);
  assert.equal(chatUnread(db, 1), 2);
  markChatSeen(db, 1);
  assert.equal(chatUnread(db, 1), 0);
});
