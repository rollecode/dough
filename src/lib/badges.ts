import { getDb } from "./db";
import { availableForCategory } from "./budget-math";
import { getHouseholdSetting } from "./household";

// The notice dots on the navigation, shared by the web sidebar and the API so both clients light
// up for the same reasons.
type Db = ReturnType<typeof getDb>;

function ensureTables(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS transactions_last_seen (
    user_id INTEGER PRIMARY KEY,
    seen_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS chat_last_seen (
    user_id INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL DEFAULT 0
  )`);
}

// Budget: a state, not a feed. Categories this month whose available has gone negative, snoozed
// ones and Ready to Assign left out, using the budget page's own available.
export function overspentCategories(db: Db, month: string): number {
  const cats = db.prepare("SELECT id, name FROM categories WHERE is_active = 1").all() as { id: number; name: string }[];
  const snoozed = new Set(
    (db.prepare("SELECT category_id FROM category_snoozes WHERE month = ?").all(month) as { category_id: number }[])
      .map((r) => r.category_id)
  );
  let overspent = 0;
  for (const c of cats) {
    if (snoozed.has(c.id) || c.name === "Inflow: Ready to Assign") continue;
    if (availableForCategory(db, c.id, c.name, month) < -0.005) overspent++;
  }
  return overspent;
}

// Transactions: 1 when an expense was added by hand after this person last looked. The first
// check only starts the clock.
export function transactionsUnread(db: Db, userId: number): number {
  ensureTables(db);
  const lastSeen = db.prepare("SELECT seen_at FROM transactions_last_seen WHERE user_id = ?").get(userId) as { seen_at: string } | undefined;
  if (!lastSeen) {
    db.prepare("INSERT INTO transactions_last_seen (user_id) VALUES (?)").run(userId);
    return 0;
  }
  const lastAdded = getHouseholdSetting("last_transaction_added");
  if (!lastAdded) return 0;
  return new Date(lastAdded).getTime() > new Date(lastSeen.seen_at + "Z").getTime() ? 1 : 0;
}

export function markTransactionsSeen(db: Db, userId: number) {
  ensureTables(db);
  // To the millisecond, as the added time is: to the second, an entry made in the same second
  // as the look read as newer and the dot never cleared.
  db.prepare(
    "INSERT INTO transactions_last_seen (user_id, seen_at) VALUES (?, strftime('%Y-%m-%d %H:%M:%f', 'now')) " +
      "ON CONFLICT(user_id) DO UPDATE SET seen_at = excluded.seen_at"
  ).run(userId);
}

// Chat: messages other people wrote since this person last had the chat open.
export function chatUnread(db: Db, userId: number): number {
  ensureTables(db);
  const lastSeen = db.prepare("SELECT message_id FROM chat_last_seen WHERE user_id = ?").get(userId) as { message_id: number } | undefined;
  const result = db
    .prepare("SELECT COUNT(*) as count FROM chat_messages WHERE id > ? AND user_id != ? AND role = 'user'")
    .get(lastSeen?.message_id || 0, userId) as { count: number };
  return result.count;
}

export function markChatSeen(db: Db, userId: number) {
  ensureTables(db);
  const latest = db.prepare("SELECT MAX(id) as max_id FROM chat_messages").get() as { max_id: number | null };
  db.prepare(
    "INSERT INTO chat_last_seen (user_id, message_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET message_id = excluded.message_id"
  ).run(userId, latest?.max_id || 0);
}
