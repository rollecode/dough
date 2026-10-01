import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { getHouseholdSetting, setHouseholdSetting } from "@/lib/household";
import { openSecret, sealSecret } from "@/lib/secrets";

const stored = (key: string) =>
  (getDb().prepare("SELECT value FROM household_settings WHERE key = ?").get(key) as { value: string }).value;

test("a secret is stored sealed and read back plain when the key is set", () => {
  process.env.DOUGH_ENCRYPTION_KEY = "a".repeat(64);
  setHouseholdSetting("synci_api_token", "token-123");
  assert.match(stored("synci_api_token"), /^enc:v1:/);
  assert.equal(getHouseholdSetting("synci_api_token"), "token-123");
  setHouseholdSetting("household_size", "3");
  assert.equal(stored("household_size"), "3", "ordinary settings are left alone");
  delete process.env.DOUGH_ENCRYPTION_KEY;
});

test("without the key nothing changes, and a value written before the key still reads", () => {
  setHouseholdSetting("gemini_api_key", "plain");
  assert.equal(stored("gemini_api_key"), "plain");
  process.env.DOUGH_ENCRYPTION_KEY = "a".repeat(64);
  assert.equal(getHouseholdSetting("gemini_api_key"), "plain");
  delete process.env.DOUGH_ENCRYPTION_KEY;
});

test("a tampered or wrongly keyed secret is refused, not misread", () => {
  process.env.DOUGH_ENCRYPTION_KEY = "a".repeat(64);
  const sealed = sealSecret("x");
  process.env.DOUGH_ENCRYPTION_KEY = "b".repeat(64);
  assert.throws(() => openSecret(sealed));
  delete process.env.DOUGH_ENCRYPTION_KEY;
});
