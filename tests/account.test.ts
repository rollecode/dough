import { test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { getDb, runWithHousehold } from "@/lib/db";
import { setHouseholdSetting } from "@/lib/household";
import { deleteAccount, exportHousehold } from "@/lib/account";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dough-account-"));
const home = (id: string) => ({ id, dbPath: path.join(dir, `${id}.db`) });

function people(...names: string[]) {
  const db = getDb();
  const hash = bcrypt.hashSync("pw", 4);
  for (const name of names) db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)").run(`${name}@example.com`, hash, name);
  return db.prepare("SELECT id FROM users ORDER BY id").all().map((r) => (r as { id: number }).id);
}

test("leaving keeps the household's records and drops only what was yours", async () => {
  await runWithHousehold(home("two"), async () => {
    const [a, b] = people("a", "b");
    const db = getDb();
    db.prepare("INSERT INTO transactions (user_id, ynab_id, date, amount, payee) VALUES (?, 't1', '2026-10-01', -5, 'Shop')").run(a);
    db.prepare("INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'user', 'hi')").run(a);
    assert.equal(await deleteAccount(a, "nope"), "wrong-password");
    assert.equal(await deleteAccount(a, "pw"), "left-household");
    assert.equal((db.prepare("SELECT user_id FROM transactions WHERE ynab_id = 't1'").get() as { user_id: number }).user_id, b);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 1);
  });
});

test("the last member takes the household with them", async () => {
  const h = home("one");
  await runWithHousehold(h, async () => {
    const [a] = people("a");
    assert.equal(await deleteAccount(a, "pw"), "erased-household");
    assert.equal(fs.existsSync(h.dbPath), false);
    assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 0, "a fresh, empty database");
  });
});

test("the export opens anywhere and carries no way back in", async () => {
  process.env.DOUGH_ENCRYPTION_KEY = "c".repeat(64);
  await runWithHousehold(home("export"), async () => {
    const [a] = people("a");
    setHouseholdSetting("synci_api_token", "bank-token");
    getDb().prepare("INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes) VALUES (?, 'k', 'dough_x', 'h', 'read')").run(a);
    const file = path.join(dir, "copy.db");
    fs.writeFileSync(file, await exportHousehold());
    const copy = new Database(file, { readonly: true });
    assert.equal((copy.prepare("SELECT value FROM household_settings WHERE key = 'synci_api_token'").get() as { value: string }).value, "bank-token");
    assert.equal((copy.prepare("SELECT COUNT(*) AS n FROM api_keys").get() as { n: number }).n, 0);
    assert.equal((copy.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 1);
    copy.close();
  });
  delete process.env.DOUGH_ENCRYPTION_KEY;
});
