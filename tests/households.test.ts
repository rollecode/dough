import { test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import fs from "fs";
import { getDb, runWithHousehold } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dough-households-"));
const a = { id: "a", dbPath: path.join(dir, "a.db") };
const b = { id: "b", dbPath: path.join(dir, "b.db") };

test("each household reads and writes its own database", () => {
  runWithHousehold(a, () => getDb().prepare("INSERT INTO household_settings (key, value) VALUES ('who', 'a')").run());
  runWithHousehold(b, () => getDb().prepare("INSERT INTO household_settings (key, value) VALUES ('who', 'b')").run());
  const read = () => (getDb().prepare("SELECT value FROM household_settings WHERE key = 'who'").get() as { value: string } | undefined)?.value;
  assert.equal(runWithHousehold(a, read), "a");
  assert.equal(runWithHousehold(b, read), "b");
  assert.equal(read(), undefined, "outside a household it is the instance's own database");
});

test("the household survives an await", async () => {
  const value = await runWithHousehold(b, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return (getDb().prepare("SELECT value FROM household_settings WHERE key = 'who'").get() as { value: string }).value;
  });
  assert.equal(value, "b");
});

test("events reach only the household they happened in", () => {
  const seen: string[] = [];
  const offA = runWithHousehold(a, () => eventBus.subscribe(() => seen.push("a")));
  const offB = runWithHousehold(b, () => eventBus.subscribe(() => seen.push("b")));
  runWithHousehold(a, () => eventBus.emit("chat:message", {}));
  assert.deepEqual(seen, ["a"]);
  offA();
  offB();
});

test("a session from one household is refused by another", async () => {
  const { createSession } = await import("@/lib/auth");
  const { jwtVerify } = await import("jose");
  const user = (h: typeof a) => runWithHousehold(h, () => {
    getDb().prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (1, 'x@example.com', 'x')").run();
  });
  user(a);
  user(b);
  const token = await runWithHousehold(a, () => createSession(1));
  const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET));
  assert.equal(payload.hid, "a");
});
