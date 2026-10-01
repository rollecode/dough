// Encrypts the credentials already in the database once DOUGH_ENCRYPTION_KEY is set. Safe to run
// again: a value that is already sealed is left as it is.
//   DOUGH_ENCRYPTION_KEY=... npx tsx scripts/seal-secrets.ts
import { getDb } from "../src/lib/db";
import { setHouseholdSetting, getHouseholdSetting } from "../src/lib/household";
import { SECRET_SETTINGS } from "../src/lib/secrets";

if (!process.env.DOUGH_ENCRYPTION_KEY) {
  console.error("Set DOUGH_ENCRYPTION_KEY first.");
  process.exit(1);
}

const rows = getDb().prepare("SELECT key, value FROM household_settings").all() as { key: string; value: string }[];
let sealed = 0;
for (const row of rows) {
  if (!SECRET_SETTINGS.has(row.key) || row.value.startsWith("enc:")) continue;
  setHouseholdSetting(row.key, getHouseholdSetting(row.key) ?? "");
  sealed++;
}
console.info("Sealed", sealed, "secrets");
