import { getDb } from "../src/lib/db";
import { generateApiKey } from "../src/lib/api-auth";

// Mint a Dough API key for programmatic access (the MCP server, scripts). Prints the plaintext key
// exactly once: only its hash is stored, so it cannot be shown again. Run from the project root:
//
//   npx tsx scripts/create-api-key.ts --name "dough-mcp" --scopes read [--email you@example.com]
//
// --scopes defaults to "read". --email selects the owning user; without it the first user is used.

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const name = arg("--name") || "api-key";
const scopesRaw = arg("--scopes") || "read";
const email = arg("--email");

const scopes = scopesRaw
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const allowed = new Set(["read", "write"]);
for (const s of scopes) {
  if (!allowed.has(s)) {
    console.error(`Unknown scope "${s}". Allowed: read, write.`);
    process.exit(1);
  }
}

const db = getDb();
const user = email
  ? (db.prepare("SELECT id, email FROM users WHERE email = ?").get(email) as { id: number; email: string } | undefined)
  : (db.prepare("SELECT id, email FROM users ORDER BY id LIMIT 1").get() as { id: number; email: string } | undefined);

if (!user) {
  console.error(email ? `No user with email ${email}` : "No users exist yet");
  process.exit(1);
}

const { key, prefix, hash } = generateApiKey();
db.prepare(
  "INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes) VALUES (?, ?, ?, ?, ?)"
).run(user.id, name, prefix, hash, scopes.join(","));

console.log("");
console.log("API key created.");
console.log("  name:   " + name);
console.log("  user:   " + user.email);
console.log("  scopes: " + scopes.join(", "));
console.log("  prefix: " + prefix);
console.log("");
console.log("  KEY (shown once, store it now):");
console.log("  " + key);
console.log("");
