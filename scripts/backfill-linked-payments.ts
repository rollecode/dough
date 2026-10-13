// Books payments filed under a linked debt or investment category since the given date, on their own
// dates. Payments on or before an account's last reconciliation are skipped, and a payment already
// entered on the account by hand is reused. Safe to run again.
//   DOUGH_DB_PATH=data/dough.db npx tsx scripts/backfill-linked-payments.ts 2026-01-31
import { getDb } from "../src/lib/db";
import { setHouseholdSetting } from "../src/lib/household";
import { syncLinkedLegs } from "../src/lib/linked-payments";

const since = process.argv[2] || "";
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error("Usage: npx tsx scripts/backfill-linked-payments.ts YYYY-MM-DD");
  process.exit(1);
}

const db = getDb();
const user = db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get() as { id: number } | undefined;
if (!user) {
  console.error("No user in this database.");
  process.exit(1);
}

const before = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE ynab_id LIKE 'link_%'").get() as { n: number };
setHouseholdSetting("linked_payments_since", since);
syncLinkedLegs(db, user.id);
const after = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE ynab_id LIKE 'link_%'").get() as { n: number };
console.info("Booked", after.n - before.n, "linked payments since", since);
