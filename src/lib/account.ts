import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { getDb, eraseCurrentDatabase, currentHousehold } from "./db";
import { createLimiter } from "./rate-limit";
import { SECRET_SETTINGS, openSecret } from "./secrets";
import { localDateIso } from "./date-utils";

// Whether the copy carries the household's credentials: the bank and AI keys and the members'
// password hashes. Only someone signed in to the app gets them; an API key or connected app does not.
export type ExportCredentials = "with-credentials" | "without-credentials";

// The household's data as one SQLite file, the same format Dough runs on, so it can be opened
// anywhere or used to start a self-hosted instance. Left out: this instance's API keys and OAuth
// tokens, which would only be a way in here. Credentials are decrypted so the copy works without
// this instance's encryption key.
export async function exportHousehold(credentials: ExportCredentials): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dough-export-"));
  const file = path.join(dir, "dough.db");
  try {
    await getDb().backup(file);
    const copy = new Database(file);
    copy.exec("DELETE FROM api_keys; DELETE FROM oauth_tokens; DELETE FROM oauth_codes; DELETE FROM oauth_clients;");
    const settings = copy.prepare("SELECT key, value FROM household_settings").all() as { key: string; value: string }[];
    const update = copy.prepare("UPDATE household_settings SET value = ? WHERE key = ?");
    for (const row of settings) {
      if (SECRET_SETTINGS.has(row.key)) update.run(openSecret(row.value), row.key);
    }
    if (credentials === "without-credentials") {
      const remove = copy.prepare("DELETE FROM household_settings WHERE key = ?");
      for (const key of SECRET_SETTINGS) remove.run(key);
      copy.exec("UPDATE users SET password_hash = '', ynab_access_token = NULL");
    }
    copy.pragma("journal_mode = DELETE");
    copy.exec("VACUUM");
    copy.close();
    return fs.readFileSync(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// What the household shares stays with whoever is left; what was only theirs goes with them.
const SHARED = ["transactions", "recurring_bills", "income_sources", "debts"];
const PERSONAL = [
  "chat_messages", "chat_reactions", "user_linked_accounts", "api_keys", "oauth_codes", "oauth_tokens",
  // Created on first use, so not every database has them.
  "ai_summaries", "typing_status", "transactions_last_seen", "chat_last_seen",
];

export type DeleteOutcome = "wrong-password" | "too-many-attempts" | "left-household" | "erased-household";

const MAX_PASSWORD_FAILURES = 5;
const PASSWORD_WINDOW_MS = 15 * 60 * 1000;
const passwordFailures = createLimiter(MAX_PASSWORD_FAILURES, PASSWORD_WINDOW_MS);

// Deletes a person's account after they confirm their password. When others are left, the shared
// records they added pass to the household's first remaining member; the last member takes the
// whole household with them.
export async function deleteAccount(userId: number, password: string): Promise<DeleteOutcome> {
  const db = getDb();
  const attempts = `${currentHousehold()?.id ?? ""}|${userId}`;
  if (passwordFailures.isLimited(attempts)) {
    console.warn("[account] Throttled account deletion for user", userId);
    return "too-many-attempts";
  }
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string } | undefined;
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    passwordFailures.record(attempts);
    return "wrong-password";
  }

  const heir = db.prepare("SELECT id FROM users WHERE id != ? ORDER BY id LIMIT 1").get(userId) as { id: number } | undefined;
  if (!heir) {
    eraseCurrentDatabase();
    return "erased-household";
  }

  const present = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name)
  );
  db.transaction(() => {
    for (const table of SHARED) db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`).run(heir.id, userId);
    for (const table of PERSONAL.filter((t) => present.has(t))) db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    db.prepare("DELETE FROM household_settings WHERE key = ?").run(`last_transaction_added:${userId}`);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  })();
  console.info("[account] User", userId, "left the household; shared records passed to user", heir.id);
  return "left-household";
}

// The export as a download, named for the day it was taken.
export async function exportResponse(credentials: ExportCredentials): Promise<Response> {
  const file = await exportHousehold(credentials);
  console.info("[account] Exported the household", credentials, file.length, "bytes");
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="dough-${localDateIso(new Date())}.db"`,
      "Cache-Control": "no-store",
    },
  });
}
