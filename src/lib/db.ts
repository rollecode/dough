import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "dough.db");

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    console.info("[db] Opening database at", DB_PATH);
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    initializeDb(_db);
  }
  return _db;
}

function initializeDb(db: Database.Database) {
  console.info("[db] Initializing schema");

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
      expected_day INTEGER NOT NULL DEFAULT 0 CHECK (expected_day BETWEEN 0 AND 31),
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
      split_group TEXT DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS net_worth_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      checking REAL NOT NULL DEFAULT 0,
      savings REAL NOT NULL DEFAULT 0,
      investments REAL NOT NULL DEFAULT 0,
      debts REAL NOT NULL DEFAULT 0,
      net_worth REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_net_worth_user_date ON net_worth_snapshots(user_id, date);

    CREATE TABLE IF NOT EXISTS investment_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ynab_account_id TEXT UNIQUE NOT NULL,
      monthly_contribution REAL NOT NULL DEFAULT 0,
      expected_return REAL NOT NULL DEFAULT 7,
      notes TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payee_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL CHECK (source_type IN ('income', 'bill', 'investment', 'subscription')),
      source_id INTEGER NOT NULL,
      payee_pattern TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_payee_matches_source ON payee_matches(source_type, source_id);

    CREATE TABLE IF NOT EXISTS monthly_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL CHECK (source_type IN ('income', 'bill', 'investment', 'subscription')),
      source_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      ynab_transaction_id TEXT NOT NULL,
      amount REAL NOT NULL,
      matched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_matches_unique ON monthly_matches(source_type, source_id, month, ynab_transaction_id);

    CREATE TABLE IF NOT EXISTS user_linked_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ynab_account_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_linked_accounts ON user_linked_accounts(user_id, ynab_account_id);

    CREATE TABLE IF NOT EXISTS daily_budget_history (
      date TEXT PRIMARY KEY,
      budget REAL NOT NULL DEFAULT 0,
      spent REAL NOT NULL DEFAULT 0,
      discretionary_target REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bill_manual_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      is_paid INTEGER NOT NULL DEFAULT 0,
      paid_amount REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_manual_status ON bill_manual_status(bill_id, month);

    CREATE TABLE IF NOT EXISTS income_manual_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      income_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      is_received INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_income_manual_status ON income_manual_status(income_id, month);

    CREATE TABLE IF NOT EXISTS income_amount_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      income_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      month TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_income_amount_month ON income_amount_history(income_id, month);

    CREATE TABLE IF NOT EXISTS bill_amount_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      month TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_amount_month ON bill_amount_history(bill_id, month);

    CREATE TABLE IF NOT EXISTS debt_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ynab_account_id TEXT UNIQUE NOT NULL,
      interest_rate REAL NOT NULL DEFAULT 0,
      minimum_payment REAL NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      due_day INTEGER NOT NULL DEFAULT 1 CHECK (due_day BETWEEN 1 AND 31),
      brand_color TEXT NOT NULL DEFAULT '#6366f1',
      brand_logo TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS account_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ynab_account_id TEXT UNIQUE NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS savings_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_amount REAL NOT NULL,
      saved_amount REAL NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'want' CHECK (priority IN ('must', 'want')),
      ynab_category_id TEXT,
      ynab_category_name TEXT,
      target_date TEXT,
      include_in_calculations INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ynab_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ynab_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      cleared_balance REAL NOT NULL DEFAULT 0,
      on_budget INTEGER NOT NULL DEFAULT 1,
      closed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ynab_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ynab_id TEXT DEFAULT '',
      month TEXT NOT NULL,
      name TEXT NOT NULL,
      group_name TEXT DEFAULT '',
      budgeted REAL NOT NULL DEFAULT 0,
      activity REAL NOT NULL DEFAULT 0,
      balance REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_ynab_categories_month_name ON ynab_categories(month, name);

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      group_name TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      color TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name ON categories(name);

    CREATE TABLE IF NOT EXISTS monthly_category_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      budgeted REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_category_budgets ON monthly_category_budgets(month, category_id);

    CREATE TABLE IF NOT EXISTS category_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id) ON DELETE CASCADE,
      monthly_amount REAL NOT NULL DEFAULT 0,
      cadence TEXT NOT NULL DEFAULT 'monthly',
      target_date TEXT DEFAULT '',
      snooze_until_month TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS category_snoozes (
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (category_id, month)
    );

    -- Opening balance anchor: the carry-in available for a category as of the first
    -- month of local history. Lets the carryover walk start with the balance a
    -- category had accumulated in YNAB before the synced window, so a cutover keeps
    -- savings/buffer balances exact instead of starting them from zero.
    CREATE TABLE IF NOT EXISTS category_opening_balances (
      category_id INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
      anchor_month TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ticker_cache (
      symbol TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      previous_close REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      day_change_pct REAL NOT NULL DEFAULT 0,
      week_52_high REAL NOT NULL DEFAULT 0,
      week_52_low REAL NOT NULL DEFAULT 0,
      sparkline_json TEXT DEFAULT '[]',
      sparkline_max_json TEXT DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ynab_month_budget (
      month TEXT PRIMARY KEY,
      income REAL NOT NULL DEFAULT 0,
      budgeted REAL NOT NULL DEFAULT 0,
      activity REAL NOT NULL DEFAULT 0,
      to_be_budgeted REAL NOT NULL DEFAULT 0,
      age_of_money INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS monthly_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT UNIQUE NOT NULL,
      income REAL NOT NULL DEFAULT 0,
      expenses REAL NOT NULL DEFAULT 0,
      categories_json TEXT NOT NULL DEFAULT '[]',
      saving_goal REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS household_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add sparkline columns to ticker_cache if missing
  try {
    const tickerCols = db.prepare("PRAGMA table_info(ticker_cache)").all() as { name: string }[];
    if (tickerCols.length > 0 && !tickerCols.some((c) => c.name === "sparkline_json")) {
      console.info("[db] Adding sparkline_json column to ticker_cache");
      db.exec("ALTER TABLE ticker_cache ADD COLUMN sparkline_json TEXT DEFAULT '[]'");
    }
    if (tickerCols.length > 0 && !tickerCols.some((c) => c.name === "sparkline_max_json")) {
      console.info("[db] Adding sparkline_max_json column to ticker_cache");
      db.exec("ALTER TABLE ticker_cache ADD COLUMN sparkline_max_json TEXT DEFAULT '[]'");
    }
  } catch (err) {
    console.warn("[db] ticker_cache migration:", err);
  }

  // Add columns to investment_overrides if missing
  const investCols = db.prepare("PRAGMA table_info(investment_overrides)").all() as { name: string }[];
  if (!investCols.some((c) => c.name === "sort_order")) {
    console.info("[db] Adding sort_order column to investment_overrides");
    db.exec("ALTER TABLE investment_overrides ADD COLUMN sort_order INTEGER DEFAULT 0");
  }
  if (!investCols.some((c) => c.name === "ticker")) {
    console.info("[db] Adding ticker column to investment_overrides");
    db.exec("ALTER TABLE investment_overrides ADD COLUMN ticker TEXT DEFAULT ''");
  }

  // Migrate transactions to shared (one copy per ynab_id, no user_id in unique constraint)
  const hasOldIndex = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_transactions_user_ynab'").get();
  if (hasOldIndex) {
    console.info("[db] Migrating transactions to shared (removing per-user duplicates)");
    // Remove duplicates: keep the lowest id per ynab_id
    db.exec("DELETE FROM transactions WHERE id NOT IN (SELECT MIN(id) FROM transactions GROUP BY ynab_id)");
    db.exec("DROP INDEX IF EXISTS idx_transactions_user_ynab");
    db.exec("DROP INDEX IF EXISTS idx_transactions_ynab_id");
    db.exec("CREATE UNIQUE INDEX idx_transactions_ynab ON transactions(ynab_id)");
    console.info("[db] Transactions migrated to shared unique index on ynab_id");
  } else {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_ynab ON transactions(ynab_id)");
  }

  // Add account_id column to transactions if missing
  const txCols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  if (!txCols.some((c) => c.name === "account_id")) {
    console.info("[db] Adding account_id column to transactions");
    db.exec("ALTER TABLE transactions ADD COLUMN account_id TEXT DEFAULT ''");
  }
  if (!txCols.some((c) => c.name === "approved")) {
    console.info("[db] Adding approved and cleared columns to transactions");
    db.exec("ALTER TABLE transactions ADD COLUMN approved INTEGER NOT NULL DEFAULT 1");
    db.exec("ALTER TABLE transactions ADD COLUMN cleared TEXT NOT NULL DEFAULT 'cleared'");
  }
  // Split transactions: child rows share a split_group id (the parent's source id). Each child is
  // a normal categorized row, so budget activity and account balances stay correct unchanged.
  if (!txCols.some((c) => c.name === "split_group")) {
    console.info("[db] Adding split_group column to transactions");
    db.exec("ALTER TABLE transactions ADD COLUMN split_group TEXT DEFAULT ''");
  }

  // Add account independence columns to ynab_accounts (also serves locally-managed accounts)
  const acctCols = db.prepare("PRAGMA table_info(ynab_accounts)").all() as { name: string }[];
  if (acctCols.length > 0 && !acctCols.some((c) => c.name === "source")) {
    console.info("[db] Adding source column to ynab_accounts");
    db.exec("ALTER TABLE ynab_accounts ADD COLUMN source TEXT NOT NULL DEFAULT 'ynab'");
  }
  if (acctCols.length > 0 && !acctCols.some((c) => c.name === "synci_account_id")) {
    console.info("[db] Adding synci_account_id column to ynab_accounts");
    db.exec("ALTER TABLE ynab_accounts ADD COLUMN synci_account_id TEXT DEFAULT ''");
  }
  if (acctCols.length > 0 && !acctCols.some((c) => c.name === "sort_order")) {
    console.info("[db] Adding sort_order column to ynab_accounts");
    db.exec("ALTER TABLE ynab_accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }

  // Add description column to categories if missing
  const catCols = db.prepare("PRAGMA table_info(categories)").all() as { name: string }[];
  if (catCols.length > 0 && !catCols.some((c) => c.name === "description")) {
    console.info("[db] Adding description column to categories");
    db.exec("ALTER TABLE categories ADD COLUMN description TEXT DEFAULT ''");
  }

  // Add cadence column to category_targets (daily/weekly/monthly/yearly) if missing
  const targetCols = db.prepare("PRAGMA table_info(category_targets)").all() as { name: string }[];
  if (targetCols.length > 0 && !targetCols.some((c) => c.name === "cadence")) {
    console.info("[db] Adding cadence column to category_targets");
    db.exec("ALTER TABLE category_targets ADD COLUMN cadence TEXT NOT NULL DEFAULT 'monthly'");
  }

  // Add target_date column to category_targets (used by the "save by date" target type) if missing
  if (targetCols.length > 0 && !targetCols.some((c) => c.name === "target_date")) {
    console.info("[db] Adding target_date column to category_targets");
    db.exec("ALTER TABLE category_targets ADD COLUMN target_date TEXT DEFAULT ''");
  }

  // Add age_of_money column to ynab_month_budget (YNAB's own per-month figure) if missing
  const monthCols = db.prepare("PRAGMA table_info(ynab_month_budget)").all() as { name: string }[];
  if (monthCols.length > 0 && !monthCols.some((c) => c.name === "age_of_money")) {
    console.info("[db] Adding age_of_money column to ynab_month_budget");
    db.exec("ALTER TABLE ynab_month_budget ADD COLUMN age_of_money INTEGER");
  }

  // Add min_amount/max_amount columns to payee_matches if missing
  const payeeCols = db.prepare("PRAGMA table_info(payee_matches)").all() as { name: string }[];
  if (!payeeCols.some((c) => c.name === "min_amount")) {
    console.info("[db] Adding min_amount and max_amount columns to payee_matches");
    db.exec("ALTER TABLE payee_matches ADD COLUMN min_amount REAL DEFAULT 0");
    db.exec("ALTER TABLE payee_matches ADD COLUMN max_amount REAL DEFAULT 0");
  }

  // Add target_account_id column to income_sources if missing
  const incomeCols = db.prepare("PRAGMA table_info(income_sources)").all() as { name: string }[];
  if (incomeCols.length > 0 && !incomeCols.some((c) => c.name === "target_account_id")) {
    console.info("[db] Adding target_account_id column to income_sources");
    db.exec("ALTER TABLE income_sources ADD COLUMN target_account_id TEXT DEFAULT ''");
  }

  // Add discretionary_target column to daily_budget_history if missing
  // Add is_hidden column to ai_summaries if missing
  try {
    const aiCols = db.prepare("PRAGMA table_info(ai_summaries)").all() as { name: string }[];
    if (aiCols.length > 0 && !aiCols.some((c) => c.name === "is_hidden")) {
      console.info("[db] Adding is_hidden column to ai_summaries");
      db.exec("ALTER TABLE ai_summaries ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0");
    }
  } catch (err) {
    console.warn("[db] ai_summaries migration:", err);
  }

  const dbhCols = db.prepare("PRAGMA table_info(daily_budget_history)").all() as { name: string }[];
  if (dbhCols.length > 0 && !dbhCols.some((c) => c.name === "discretionary_target")) {
    console.info("[db] Adding discretionary_target column to daily_budget_history");
    db.exec("ALTER TABLE daily_budget_history ADD COLUMN discretionary_target REAL NOT NULL DEFAULT 0");
  }

  // Add image_thumb column to chat_messages if missing
  const chatCols = db.prepare("PRAGMA table_info(chat_messages)").all() as { name: string }[];
  if (!chatCols.some((c) => c.name === "image_thumb")) {
    console.info("[db] Adding image_thumb column to chat_messages");
    db.exec("ALTER TABLE chat_messages ADD COLUMN image_thumb TEXT");
  }

  // Add columns to debt_overrides if missing
  const debtCols = db.prepare("PRAGMA table_info(debt_overrides)").all() as { name: string }[];
  if (!debtCols.some((c) => c.name === "due_day")) {
    console.info("[db] Adding due_day column to debt_overrides");
    db.exec("ALTER TABLE debt_overrides ADD COLUMN due_day INTEGER DEFAULT 0");
  }
  if (!debtCols.some((c) => c.name === "sort_order")) {
    console.info("[db] Adding sort_order column to debt_overrides");
    db.exec("ALTER TABLE debt_overrides ADD COLUMN sort_order INTEGER DEFAULT 0");
  }

  // Add budget_share column to users if missing
  const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userCols.some((c) => c.name === "budget_share")) {
    console.info("[db] Adding budget_share column to users");
    db.exec("ALTER TABLE users ADD COLUMN budget_share INTEGER NOT NULL DEFAULT 0");
  }

  // Migrate payee_matches/monthly_matches to support 'investment' and 'subscription' source_type
  const payeeCheck = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'payee_matches'").get() as { sql: string } | undefined;
  if (payeeCheck?.sql && (!payeeCheck.sql.includes("investment") || !payeeCheck.sql.includes("subscription"))) {
    console.info("[db] Migrating payee_matches and monthly_matches to support subscription source_type");
    db.exec(`DROP TABLE IF EXISTS payee_matches_new; DROP TABLE IF EXISTS monthly_matches_new;`);
    db.exec(`
      CREATE TABLE payee_matches_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL CHECK (source_type IN ('income', 'bill', 'investment', 'subscription')),
        source_id INTEGER NOT NULL,
        payee_pattern TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        min_amount REAL DEFAULT 0,
        max_amount REAL DEFAULT 0
      );
      INSERT INTO payee_matches_new (id, source_type, source_id, payee_pattern, created_at, min_amount, max_amount)
        SELECT id, source_type, source_id, payee_pattern, created_at, COALESCE(min_amount, 0), COALESCE(max_amount, 0) FROM payee_matches;
      DROP TABLE payee_matches;
      ALTER TABLE payee_matches_new RENAME TO payee_matches;
      CREATE INDEX IF NOT EXISTS idx_payee_matches_source ON payee_matches(source_type, source_id);

      CREATE TABLE monthly_matches_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL CHECK (source_type IN ('income', 'bill', 'investment', 'subscription')),
        source_id INTEGER NOT NULL,
        month TEXT NOT NULL,
        ynab_transaction_id TEXT NOT NULL,
        amount REAL NOT NULL,
        matched_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO monthly_matches_new SELECT * FROM monthly_matches;
      DROP TABLE monthly_matches;
      ALTER TABLE monthly_matches_new RENAME TO monthly_matches;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_matches_unique ON monthly_matches(source_type, source_id, month, ynab_transaction_id);
    `);
    console.info("[db] Migration complete");
  }

  // Track processed Synci transactions to prevent duplicates
  const hasSynciProcessed = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='synci_processed'").get();
  if (!hasSynciProcessed) {
    console.info("[db] Creating synci_processed table");
    db.exec(`
      CREATE TABLE synci_processed (
        synci_tx_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // Add is_priority column to bills, subscriptions, debt_overrides
  const billCols = db.prepare("PRAGMA table_info(recurring_bills)").all() as { name: string }[];
  if (!billCols.some((c) => c.name === "is_priority")) {
    console.info("[db] Adding is_priority column to recurring_bills, subscriptions, debt_overrides");
    db.exec("ALTER TABLE recurring_bills ADD COLUMN is_priority INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE subscriptions ADD COLUMN is_priority INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE debt_overrides ADD COLUMN is_priority INTEGER NOT NULL DEFAULT 0");
  }

  // Create chat_reactions table if missing
  const hasReactions = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_reactions'").get();
  if (!hasReactions) {
    console.info("[db] Creating chat_reactions table");
    db.exec(`
      CREATE TABLE chat_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(message_id, user_id, emoji)
      );
      CREATE INDEX idx_chat_reactions_message ON chat_reactions(message_id);
    `);
  }

  // One-time migration of YNAB settings from users to household_settings.
  // Guarded by a flag and clears the source columns afterwards, so a later
  // disconnect (which removes the household_settings keys) is never resurrected.
  const ynabMigrated = db.prepare("SELECT value FROM household_settings WHERE key = 'ynab_user_migrated'").get();
  if (!ynabMigrated) {
    const existingYnab = db.prepare("SELECT ynab_access_token, ynab_budget_id FROM users WHERE ynab_access_token IS NOT NULL LIMIT 1").get() as { ynab_access_token: string; ynab_budget_id: string | null } | undefined;
    const hasHousehold = db.prepare("SELECT value FROM household_settings WHERE key = 'ynab_access_token'").get();
    if (existingYnab && !hasHousehold) {
      console.info("[db] Migrating YNAB settings from users to household_settings (one-time)");
      db.prepare("INSERT OR IGNORE INTO household_settings (key, value) VALUES (?, ?)").run("ynab_access_token", existingYnab.ynab_access_token);
      if (existingYnab.ynab_budget_id) {
        db.prepare("INSERT OR IGNORE INTO household_settings (key, value) VALUES (?, ?)").run("ynab_budget_id", existingYnab.ynab_budget_id);
      }
    }
    // Clear the stale source so disconnect sticks, and mark migration done
    db.exec("UPDATE users SET ynab_access_token = NULL, ynab_budget_id = NULL WHERE ynab_access_token IS NOT NULL");
    db.prepare("INSERT OR IGNORE INTO household_settings (key, value) VALUES ('ynab_user_migrated', '1')").run();
  }

  // One-time seed: copy distinct categories from ynab_categories into local categories
  // table if the local table is empty and the YNAB mirror has data. Idempotent (no-op once seeded).
  try {
    const localCount = (db.prepare("SELECT COUNT(*) AS c FROM categories").get() as { c: number }).c;
    if (localCount === 0) {
      const ynabCatRows = db.prepare(
        "SELECT name, group_name FROM ynab_categories WHERE name NOT LIKE 'Inflow%' AND name != 'Uncategorized' GROUP BY name ORDER BY group_name, name"
      ).all() as { name: string; group_name: string }[];
      if (ynabCatRows.length > 0) {
        console.info("[db] Seeding local categories from ynab_categories,", ynabCatRows.length, "rows");
        const ins = db.prepare("INSERT OR IGNORE INTO categories (name, group_name, sort_order) VALUES (?, ?, ?)");
        let order = 0;
        for (const r of ynabCatRows) ins.run(r.name, r.group_name || "", order++);
      }
    }
    // Self-heal groups for categories synced from an older DB where the YNAB mirror lacked groups
    backfillCategoryGroups(db);
    // Seed local monthly assigned amounts from YNAB so the budget page is not all-zero after a cutover
    seedMonthlyBudgetsFromYnab(db, false);
    // Seed opening balance anchors so accumulated balances (savings, buffers) survive a cutover
    seedOpeningBalancesFromYnab(db);
  } catch (err) {
    console.warn("[db] categories seed:", err);
  }

  console.info("[db] Schema initialized");
}

// Backfill empty category group_name values from the YNAB mirror (idempotent).
// Runs on startup and after each YNAB sync so categories pick up their groups
// once the ynab_categories mirror has them.
export function backfillCategoryGroups(db: Database.Database): number {
  try {
    const res = db
      .prepare(
        `UPDATE categories SET group_name = (
           SELECT yc.group_name FROM ynab_categories yc
           WHERE yc.name = categories.name AND COALESCE(yc.group_name, '') <> ''
           ORDER BY yc.month DESC LIMIT 1
         )
         WHERE COALESCE(group_name, '') = '' AND EXISTS (
           SELECT 1 FROM ynab_categories yc
           WHERE yc.name = categories.name AND COALESCE(yc.group_name, '') <> ''
         )`
      )
      .run();
    if (res.changes > 0) console.info("[db] Backfilled group_name for", res.changes, "categories");
    return res.changes;
  } catch (err) {
    console.warn("[db] backfillCategoryGroups:", err);
    return 0;
  }
}

// Seed local monthly assigned amounts from the YNAB mirror so the budget page reflects
// YNAB allocations (and a YNAB->local cutover is seamless). On startup we only fill missing
// rows; after a YNAB sync we overwrite so YNAB stays the source of truth while connected.
export function seedMonthlyBudgetsFromYnab(db: Database.Database, overwrite = false): number {
  try {
    const conflict = overwrite
      ? "ON CONFLICT(month, category_id) DO UPDATE SET budgeted = excluded.budgeted, updated_at = datetime('now')"
      : "ON CONFLICT(month, category_id) DO NOTHING";
    const res = db
      .prepare(
        `INSERT INTO monthly_category_budgets (month, category_id, budgeted)
         SELECT yc.month, c.id, yc.budgeted
         FROM ynab_categories yc JOIN categories c ON c.name = yc.name
         WHERE yc.budgeted <> 0
         ${conflict}`
      )
      .run();
    if (res.changes > 0) {
      console.info("[db] Seeded monthly budgets from YNAB:", res.changes, overwrite ? "(overwrite)" : "(missing only)");
    }
    return res.changes;
  } catch (err) {
    console.warn("[db] seedMonthlyBudgetsFromYnab:", err);
    return 0;
  }
}

// Seed each category's opening balance anchor from the YNAB mirror so a cutover keeps
// balances that accumulated before the synced window (savings buffers, sinking funds)
// exact. YNAB's reported balance for the earliest synced month already encodes all prior
// history, so the carry-in to that month is balance - budgeted - activity (activity is
// stored negative). The carryover walk then starts at that month with this carry instead
// of zero. Idempotent: re-run on every sync to keep the anchor current.
export function seedOpeningBalancesFromYnab(db: Database.Database): number {
  try {
    const res = db
      .prepare(
        `INSERT INTO category_opening_balances (category_id, anchor_month, balance, updated_at)
         SELECT c.id, e.first_month,
                ROUND(yc.balance - yc.budgeted - yc.activity, 2),
                datetime('now')
         FROM categories c
         JOIN (
           SELECT name, MIN(month) AS first_month
           FROM ynab_categories
           GROUP BY name
         ) e ON e.name = c.name
         JOIN ynab_categories yc ON yc.name = c.name AND yc.month = e.first_month
         ON CONFLICT(category_id) DO UPDATE SET
           anchor_month = excluded.anchor_month,
           balance = excluded.balance,
           updated_at = datetime('now')`
      )
      .run();
    if (res.changes > 0) console.info("[db] Seeded opening balances from YNAB:", res.changes, "categories");
    return res.changes;
  } catch (err) {
    console.warn("[db] seedOpeningBalancesFromYnab:", err);
    return 0;
  }
}
