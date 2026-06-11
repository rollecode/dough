import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getDb } from "./db";
import bcrypt from "bcryptjs";

// Fail closed: a missing SESSION_SECRET must never silently fall back to a default that is
// visible in this public repository - that would let anyone forge a valid session.
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}
const JWT_SECRET = new TextEncoder().encode(process.env.SESSION_SECRET);
const COOKIE_NAME = "dough-session";

// Hash compared against when the email does not exist, so unknown and known emails take the
// same time to reject (prevents user enumeration via response timing).
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer", 10);

export interface SessionUser {
  id: number;
  email: string;
  display_name: string;
  locale: string;
  ynab_connected: boolean;
  ynab_budget_id: string | null;
  last_ynab_sync: string | null;
}

export async function createSession(userId: number): Promise<string> {
  // Embed the user's current session version; bumping users.session_version invalidates every
  // previously issued token for that user (server-side revocation for the 30-day sessions).
  const db = getDb();
  const row = db.prepare("SELECT session_version FROM users WHERE id = ?").get(userId) as { session_version: number } | undefined;
  const sv = row?.session_version ?? 1;
  const token = await new SignJWT({ userId, sv })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(JWT_SECRET);

  console.info("[auth] Session created for user", userId);
  return token;
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    const userId = payload.userId as number;

    const db = getDb();
    const row = db
      .prepare("SELECT id, email, display_name, locale, ynab_access_token, ynab_budget_id, last_ynab_sync, session_version FROM users WHERE id = ?")
      .get(userId) as (SessionUser & { ynab_access_token: string | null; session_version: number }) | undefined;

    if (!row) return null;

    // Tokens issued before a session_version bump are revoked. Tokens minted before this claim
    // existed carry no sv and are treated as version 1.
    const tokenVersion = typeof payload.sv === "number" ? payload.sv : 1;
    if (tokenVersion !== (row.session_version ?? 1)) {
      console.warn("[auth] Rejected token with stale session version for user", userId);
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      locale: row.locale,
      ynab_connected: !!row.ynab_access_token,
      ynab_budget_id: row.ynab_budget_id,
      last_ynab_sync: row.last_ynab_sync,
    };
  } catch (error) {
    console.debug("[auth] Invalid session:", error);
    return null;
  }
}

export async function login(
  email: string,
  password: string
): Promise<{ user: SessionUser; token: string } | null> {
  const db = getDb();
  const dbRow = db
    .prepare("SELECT id, email, display_name, locale, password_hash, ynab_access_token, ynab_budget_id, last_ynab_sync FROM users WHERE email = ?")
    .get(email) as (SessionUser & { password_hash: string; ynab_access_token: string | null }) | undefined;

  if (!dbRow) {
    // Burn the same bcrypt cost as a real comparison so timing does not reveal valid emails
    await bcrypt.compare(password, DUMMY_HASH);
    console.warn("[auth] Login failed: user not found", email);
    return null;
  }

  const valid = await bcrypt.compare(password, dbRow.password_hash);
  if (!valid) {
    console.warn("[auth] Login failed: wrong password for", email);
    return null;
  }

  const token = await createSession(dbRow.id);
  console.info("[auth] Login successful for", email);

  return {
    user: {
      id: dbRow.id,
      email: dbRow.email,
      display_name: dbRow.display_name,
      locale: dbRow.locale,
      ynab_connected: !!dbRow.ynab_access_token,
      ynab_budget_id: dbRow.ynab_budget_id,
      last_ynab_sync: dbRow.last_ynab_sync,
    },
    token,
  };
}

export function createUser(email: string, password: string, displayName: string, locale: string = "en") {
  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);

  const result = db
    .prepare("INSERT INTO users (email, password_hash, display_name, locale) VALUES (?, ?, ?, ?)")
    .run(email, hash, displayName, locale);

  console.info("[auth] User created:", email, "id:", result.lastInsertRowid);
  return result.lastInsertRowid;
}

export { COOKIE_NAME };
