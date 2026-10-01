import { getHouseholdSetting, setHouseholdSetting } from "@/lib/household";
import { getDb } from "@/lib/db";

// Signing in to YNAB instead of pasting a personal token. Needs an OAuth app registered at
// app.ynab.com (Account settings, Developer settings) with YNAB_CLIENT_ID and YNAB_CLIENT_SECRET set
// here. YNAB only accepts redirect addresses it was given exactly, so a service hosting many
// households sets YNAB_REDIRECT_URI to one fixed address that forwards the code on (see state).
const YNAB = "https://app.ynab.com/oauth";

export function ynabOAuthConfigured(): boolean {
  return !!(process.env.YNAB_CLIENT_ID && process.env.YNAB_CLIENT_SECRET);
}

export function redirectUri(issuer: string): string {
  return process.env.YNAB_REDIRECT_URI || `${issuer}/api/ynab/oauth/callback`;
}

// The state carries the address to come back to, so a shared redirect can send the code on to it.
export function makeState(issuer: string, nonce: string): string {
  return Buffer.from(JSON.stringify({ back: issuer, nonce })).toString("base64url");
}

export function authorizeUrl(issuer: string, state: string): string {
  const url = new URL(`${YNAB}/authorize`);
  url.searchParams.set("client_id", process.env.YNAB_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri(issuer));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<void> {
  const response = await fetch(`${YNAB}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.YNAB_CLIENT_ID!, client_secret: process.env.YNAB_CLIENT_SECRET!, ...params }),
  });
  if (!response.ok) throw new Error(`YNAB token request failed with ${response.status}`);
  const data = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
  setHouseholdSetting("ynab_access_token", data.access_token);
  setHouseholdSetting("ynab_refresh_token", data.refresh_token);
  setHouseholdSetting("ynab_token_expires_at", String(Date.now() + data.expires_in * 1000));
}

export function exchangeCode(code: string, issuer: string): Promise<void> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(issuer) });
}

// The YNAB token to call with: a pasted personal token as it is, a signed-in one renewed when it is
// within a minute of running out.
export async function ynabToken(): Promise<string | null> {
  const token = getHouseholdSetting("ynab_access_token");
  const refresh = getHouseholdSetting("ynab_refresh_token");
  const expires = Number(getHouseholdSetting("ynab_token_expires_at") || 0);
  if (!token || !refresh || !expires || Date.now() < expires - 60_000 || !ynabOAuthConfigured()) return token;
  try {
    await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
    console.info("[ynab-oauth] Renewed the YNAB token");
    return getHouseholdSetting("ynab_access_token");
  } catch (err) {
    console.error("[ynab-oauth] Renewal failed:", err);
    return token;
  }
}

export function forgetYnabSignIn(): void {
  getDb().prepare("DELETE FROM household_settings WHERE key IN ('ynab_refresh_token', 'ynab_token_expires_at')").run();
}
