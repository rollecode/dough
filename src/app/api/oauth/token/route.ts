import { NextResponse } from "next/server";
import { exchangeCode, refreshTokens } from "@/lib/oauth";

// RFC 6749 token endpoint, as narrowed by OAuth 2.1: authorization_code with PKCE, and
// refresh_token with rotation. No client secrets, no implicit grant, no password grant.
export async function POST(request: Request) {
  const form = await readBody(request);
  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const clientId = form.get("client_id");
    const redirectUri = form.get("redirect_uri");
    const codeVerifier = form.get("code_verifier");

    if (!code || !clientId || !redirectUri || !codeVerifier) {
      return fail("invalid_request", "code, client_id, redirect_uri and code_verifier are required");
    }

    const result = exchangeCode({ code, clientId, redirectUri, codeVerifier });
    if ("error" in result) return fail(result.error, "the code is unknown, used, expired or does not match");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    const clientId = form.get("client_id");
    if (!refreshToken || !clientId) return fail("invalid_request", "refresh_token and client_id are required");

    const result = refreshTokens(refreshToken, clientId);
    if ("error" in result) return fail(result.error, "the refresh token is unknown, rotated away, revoked or expired");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  }

  return fail("unsupported_grant_type", "only authorization_code and refresh_token are supported");
}

// Token requests are form encoded by the spec, but a JSON body is common enough in the wild that
// accepting both costs nothing and saves an afternoon of debugging.
async function readBody(request: Request): Promise<Map<string, string>> {
  const contentType = request.headers.get("content-type") || "";
  const entries = new Map<string, string>();

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    for (const [key, value] of Object.entries(body)) entries.set(key, String(value));
    return entries;
  }

  const form = await request.formData().catch(() => null);
  if (form) {
    for (const [key, value] of form.entries()) entries.set(key, String(value));
  }
  return entries;
}

function fail(error: string, description: string) {
  console.warn("[oauth] Token request failed:", error);
  return NextResponse.json({ error, error_description: description }, { status: 400, headers: { "Cache-Control": "no-store" } });
}
