import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { WRITABLE_SETTINGS } from "@/lib/household";

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full) : /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

test("the server's own settings cannot be written from the web app", () => {
  for (const key of ["ai_spend:2026-10", "ai_last_claude", "ai_last_gemini", "cron_secret", "ynab_user_migrated"]) {
    assert.equal(WRITABLE_SETTINGS.has(key), false, key);
  }
});

test("every setting the web app saves is allowed", () => {
  const sent = new Set<string>();
  for (const file of files("src")) {
    const source = fs.readFileSync(file, "utf8");
    for (const call of source.matchAll(/fetch\(\s*"\/api\/household"\s*,\s*\{[\s\S]{0,400}?body:\s*JSON\.stringify\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      for (const key of call[1].matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*:/gi)) sent.add(key[1]);
    }
  }
  sent.delete("key");
  assert.ok(sent.size > 10);
  assert.deepEqual([...sent].filter((key) => !WRITABLE_SETTINGS.has(key)), []);
});
