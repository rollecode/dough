import { getDb, runWithHousehold } from "../src/lib/db";

// Bring each database file up to the current schema. Opening a database runs its migrations, so a
// hosting service runs this over every household after a release:
//
//   npx tsx scripts/migrate.ts households/*.db

const files = process.argv.slice(2);
for (const file of files) {
  runWithHousehold({ id: file, dbPath: file }, () => getDb());
}
console.info(`Migrated ${files.length} database${files.length === 1 ? "" : "s"}`);
