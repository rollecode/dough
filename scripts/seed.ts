import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "dough.db");
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'fi')),
    ynab_access_token TEXT,
    ynab_budget_id TEXT,
    last_ynab_sync TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS recurring_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
    category TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS income_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    expected_day INTEGER NOT NULL CHECK (expected_day BETWEEN 1 AND 31),
    is_recurring INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    total_amount REAL NOT NULL,
    remaining_amount REAL NOT NULL,
    interest_rate REAL NOT NULL DEFAULT 0,
    minimum_payment REAL NOT NULL DEFAULT 0,
    due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ynab_id TEXT,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    payee TEXT NOT NULL DEFAULT '',
    category TEXT DEFAULT '',
    memo TEXT DEFAULT '',
    is_recurring INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date DESC);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id, created_at DESC);
`);

// Seed users. Passwords must come from env - the app is designed to be internet-exposed, so a
// guessable default would create a publicly known login. User 2 is only created when configured.
if (!process.env.USER1_PASSWORD) {
  console.error("USER1_PASSWORD environment variable is required (no default password is seeded).");
  process.exit(1);
}
const users = [
  { email: process.env.USER1_EMAIL || "user1", password: process.env.USER1_PASSWORD, name: process.env.USER1_NAME || "User 1", locale: "en" },
];
if (process.env.USER2_EMAIL || process.env.USER2_PASSWORD) {
  if (!process.env.USER2_PASSWORD) {
    console.error("USER2_PASSWORD is required when USER2_EMAIL is set.");
    process.exit(1);
  }
  users.push({ email: process.env.USER2_EMAIL || "user2", password: process.env.USER2_PASSWORD, name: process.env.USER2_NAME || "User 2", locale: "fi" });
}

const insertUser = db.prepare(
  "INSERT OR IGNORE INTO users (email, password_hash, display_name, locale) VALUES (?, ?, ?, ?)"
);

for (const u of users) {
  const hash = bcrypt.hashSync(u.password, 10);
  const result = insertUser.run(u.email, hash, u.name, u.locale);
  if (result.changes > 0) {
    console.log(`Created user: ${u.email}`);
  } else {
    console.log(`User already exists: ${u.email}`);
  }
}

console.log("Seed complete.");
db.close();
