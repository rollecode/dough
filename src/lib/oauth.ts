import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { getDb } from "./db";

// OAuth 2.1 for this instance. Every Dough is its own authorization server: a client discovers the
// endpoints from the host it was pointed at, registers itself, and sends the person to their own
// instance to sign in. Nothing here talks to any central service, because there isn't one.
//
// Tokens are opaque random strings; only their SHA-256 hash is stored, exactly as API keys are, so
// the database never holds anything that can be replayed. PKCE is required, codes are single use,
// and refresh tokens rotate.

const ACCESS_PREFIX = "dough_at_";
const REFRESH_PREFIX = "dough_rt_";
const CODE_PREFIX = "dough_ac_";

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_DAYS = 400;
const CODE_TTL_SECONDS = 120;

export const SUPPORTED_SCOPES = ["read", "write"] as const;

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function iso(secondsFromNow: number): string {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString();
}

// A native app cannot keep a secret, so clients here are public: registration hands back an id and
// nothing else, and the redirect URI plus PKCE are what tie a code to the app that asked for it.
export function registerClient(name: string, redirectUris: string[]): OAuthClient {
  const db = getDb();
  const clientId = "dough_client_" + randomBytes(16).toString("hex");
  db.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)").run(
    clientId,
    name.slice(0, 120),
    JSON.stringify(redirectUris)
  );
  console.info("[oauth] Registered client", clientId, "for", redirectUris.join(" "));
  return { client_id: clientId, client_name: name, redirect_uris: redirectUris };
}

export function getClient(clientId: string): OAuthClient | null {
  const row = getDb()
    .prepare("SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?")
    .get(clientId) as { client_id: string; client_name: string; redirect_uris: string } | undefined;
  if (!row) return null;
  try {
    return { client_id: row.client_id, client_name: row.client_name, redirect_uris: JSON.parse(row.redirect_uris) };
  } catch {
    console.warn("[oauth] Client", clientId, "has unreadable redirect_uris");
    return null;
  }
}

// Exact match only. A prefix match would let a registered dough://connect accept
// dough://connect.attacker, which is the whole reason redirect URIs are registered.
export function redirectUriAllowed(client: OAuthClient, redirectUri: string): boolean {
  return client.redirect_uris.includes(redirectUri);
}

// A redirect target has to be either the app's own scheme or loopback. Anything else would let a
// code land on a web page belonging to somebody else.
export function isAcceptableRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    }
    // A custom scheme needs a dot in it, per the native app guidance: com.example.app:/callback.
    return url.protocol.length > 1 && !url.protocol.startsWith("javascript");
  } catch {
    return false;
  }
}

export function normaliseScopes(requested: string | null | undefined): string[] {
  const asked = (requested || "read")
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const granted = asked.filter((s) => (SUPPORTED_SCOPES as readonly string[]).includes(s));
  return granted.length > 0 ? granted : ["read"];
}

export function issueCode(params: {
  clientId: string;
  userId: number;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
}): string {
  const code = CODE_PREFIX + randomBytes(32).toString("base64url");
  getDb()
    .prepare(
      "INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, scope, code_challenge, expires_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      sha256(code),
      params.clientId,
      params.userId,
      params.redirectUri,
      params.scopes.join(" "),
      params.codeChallenge,
      iso(CODE_TTL_SECONDS)
    );
  console.info("[oauth] Issued code for client", params.clientId, "user", params.userId);
  return code;
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

function mintTokens(clientId: string, userId: number, scopes: string[]): TokenSet {
  const access = ACCESS_PREFIX + randomBytes(32).toString("base64url");
  const refresh = REFRESH_PREFIX + randomBytes(32).toString("base64url");
  getDb()
    .prepare(
      "INSERT INTO oauth_tokens (token_hash, refresh_hash, client_id, user_id, scope, expires_at, refresh_expires_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      sha256(access),
      sha256(refresh),
      clientId,
      userId,
      scopes.join(" "),
      iso(ACCESS_TOKEN_TTL_SECONDS),
      iso(REFRESH_TOKEN_TTL_DAYS * 24 * 3600)
    );
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: scopes.join(" "),
  };
}

// Exchange a code. The verifier proves this is the same app that started the flow, which is what
// stops another app on the phone claiming the callback and redeeming the code.
export function exchangeCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): TokenSet | { error: string } {
  const db = getDb();
  const hash = sha256(params.code);
  const row = db
    .prepare(
      "SELECT code_hash, client_id, user_id, redirect_uri, scope, code_challenge, expires_at, used_at " +
        "FROM oauth_codes WHERE code_hash = ?"
    )
    .get(hash) as
    | {
        code_hash: string; client_id: string; user_id: number; redirect_uri: string;
        scope: string; code_challenge: string; expires_at: string; used_at: string | null;
      }
    | undefined;

  if (!row) {
    console.warn("[oauth] Unknown authorization code presented");
    return { error: "invalid_grant" };
  }

  // A replayed code means the first one may have leaked, so every token from it goes too.
  if (row.used_at) {
    console.warn("[oauth] Authorization code replayed, revoking its tokens");
    db.prepare("UPDATE oauth_tokens SET revoked_at = datetime('now') WHERE client_id = ? AND user_id = ? AND revoked_at IS NULL")
      .run(row.client_id, row.user_id);
    return { error: "invalid_grant" };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    console.warn("[oauth] Authorization code expired");
    return { error: "invalid_grant" };
  }
  if (row.client_id !== params.clientId || row.redirect_uri !== params.redirectUri) {
    console.warn("[oauth] Code presented by the wrong client or redirect URI");
    return { error: "invalid_grant" };
  }

  const challenge = createHash("sha256").update(params.codeVerifier).digest("base64url");
  if (challenge !== row.code_challenge) {
    console.warn("[oauth] PKCE verifier did not match the challenge");
    return { error: "invalid_grant" };
  }

  db.prepare("UPDATE oauth_codes SET used_at = datetime('now') WHERE code_hash = ?").run(hash);
  console.info("[oauth] Exchanged code for tokens, user", row.user_id);
  return mintTokens(row.client_id, row.user_id, row.scope.split(" ").filter(Boolean));
}

// Refresh tokens rotate: the old one dies as the new one is minted, so a stolen refresh token is
// usable at most once and its use is visible the next time the real client tries.
export function refreshTokens(refreshToken: string, clientId: string): TokenSet | { error: string } {
  const db = getDb();
  const hash = sha256(refreshToken);
  const row = db
    .prepare(
      "SELECT id, client_id, user_id, scope, refresh_expires_at, revoked_at FROM oauth_tokens WHERE refresh_hash = ?"
    )
    .get(hash) as
    | { id: number; client_id: string; user_id: number; scope: string; refresh_expires_at: string; revoked_at: string | null }
    | undefined;

  if (!row || row.revoked_at) {
    console.warn("[oauth] Unknown or revoked refresh token");
    return { error: "invalid_grant" };
  }
  if (row.client_id !== clientId) {
    console.warn("[oauth] Refresh token presented by the wrong client");
    return { error: "invalid_grant" };
  }
  if (new Date(row.refresh_expires_at).getTime() < Date.now()) {
    console.warn("[oauth] Refresh token expired");
    return { error: "invalid_grant" };
  }

  db.prepare("UPDATE oauth_tokens SET revoked_at = datetime('now') WHERE id = ?").run(row.id);
  console.info("[oauth] Rotated tokens for user", row.user_id);
  return mintTokens(row.client_id, row.user_id, row.scope.split(" ").filter(Boolean));
}

export function revokeToken(token: string): boolean {
  const db = getDb();
  const hash = sha256(token);
  const result = db
    .prepare("UPDATE oauth_tokens SET revoked_at = datetime('now') WHERE (token_hash = ? OR refresh_hash = ?) AND revoked_at IS NULL")
    .run(hash, hash);
  if (result.changes > 0) console.info("[oauth] Revoked a token");
  return result.changes > 0;
}

// Resolve an access token to its owner and scopes, for the v1 API. Returns null for anything
// unknown, revoked or expired, and never logs the token itself.
export function authenticateAccessToken(token: string): { userId: number; scopes: string[] } | null {
  if (!token.startsWith(ACCESS_PREFIX)) return null;
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, user_id, token_hash, scope, expires_at, revoked_at FROM oauth_tokens WHERE token_hash = ?"
    )
    .get(sha256(token)) as
    | { id: number; user_id: number; token_hash: string; scope: string; expires_at: string; revoked_at: string | null }
    | undefined;

  if (!row) {
    console.warn("[oauth] Rejected unknown access token");
    return null;
  }
  if (row.revoked_at) {
    console.warn("[oauth] Rejected revoked access token for user", row.user_id);
    return null;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    console.debug("[oauth] Access token expired for user", row.user_id);
    return null;
  }
  if (!hashesEqual(row.token_hash, sha256(token))) return null;

  db.prepare("UPDATE oauth_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return { userId: row.user_id, scopes: row.scope.split(" ").filter(Boolean) };
}

// The issuer as seen by the client: whatever host it reached, so a self-hosted instance and the
// hosted one each describe themselves correctly without configuration.
export function issuerFor(request: Request): string {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("host") || url.host;
  const proto = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
