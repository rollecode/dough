import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { getDb } from "./db";

// Programmatic API-key auth, used by /api/v1/* so external clients (the Dough MCP server, scripts)
// can authenticate without a browser session cookie. Keys are high-entropy random tokens; only their
// SHA-256 hash is stored, so the database never holds a usable secret. The plaintext is shown once at
// creation. This lives beside the JWT session auth in lib/auth.ts, never replacing it.

const KEY_PREFIX = "dough_";
// Stored, indexed identifier for a key: the scheme prefix plus the first 8 random chars. Enough to
// look a key up and show it in a list without revealing the secret.
const LOOKUP_LEN = KEY_PREFIX.length + 8;

export interface ApiKeyIdentity {
  userId: number;
  scopes: string[];
}

// Generate a fresh key: the plaintext (returned once, never stored), its lookup prefix and the
// SHA-256 hash to persist. Shared by the minting script and any future settings UI so both hash and
// slice identically.
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, prefix: key.slice(0, LOOKUP_LEN), hash: sha256(key) };
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// Constant-time hex-digest comparison; both digests are fixed 64-char hex so lengths always match.
function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Extract the presented key from either `Authorization: Bearer <key>` or an `x-api-key` header.
function extractKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const x = request.headers.get("x-api-key");
  return x ? x.trim() : null;
}

// Resolve a request's API key to its owner and scopes, or null when absent/invalid/revoked. Verbose
// logging at each decision point, per the project's logging policy, but never logs the key itself.
export function authenticateApiKey(request: Request): ApiKeyIdentity | null {
  const key = extractKey(request);
  if (!key || !key.startsWith(KEY_PREFIX)) {
    console.debug("[api-auth] No API key presented");
    return null;
  }
  const prefix = key.slice(0, LOOKUP_LEN);
  const hash = sha256(key);
  const db = getDb();
  const rows = db
    .prepare("SELECT id, user_id, key_hash, scopes FROM api_keys WHERE key_prefix = ? AND revoked_at IS NULL")
    .all(prefix) as { id: number; user_id: number; key_hash: string; scopes: string }[];
  for (const row of rows) {
    if (hashesEqual(row.key_hash, hash)) {
      db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
      const scopes = row.scopes.split(",").map((s) => s.trim()).filter(Boolean);
      console.info("[api-auth] Authenticated API key", prefix, "user", row.user_id, "scopes", scopes.join("|"));
      return { userId: row.user_id, scopes };
    }
  }
  console.warn("[api-auth] Rejected unknown or revoked API key", prefix);
  return null;
}

// True when the identity carries the given scope. "read" is implied by "write" so a read-write key
// passes read checks.
export function hasScope(identity: ApiKeyIdentity, scope: "read" | "write"): boolean {
  if (identity.scopes.includes(scope)) return true;
  if (scope === "read" && identity.scopes.includes("write")) return true;
  return false;
}

// One-call guard for a v1 route: returns the identity, or an { error } describing the HTTP failure
// (401 no/invalid key, 403 wrong scope) that the route turns into a JSON response.
export function authorize(
  request: Request,
  scope: "read" | "write"
): { identity: ApiKeyIdentity } | { error: { status: number; message: string } } {
  const identity = authenticateApiKey(request);
  if (!identity) return { error: { status: 401, message: "Invalid or missing API key" } };
  if (!hasScope(identity, scope)) return { error: { status: 403, message: `API key is missing the '${scope}' scope` } };
  return { identity };
}
