import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { issuerFor } from "@/lib/oauth";
import { exchangeCode } from "@/lib/ynab/oauth";
import { secretsEqual } from "@/lib/household";

// GET /api/ynab/oauth/callback?code&state - YNAB sends the person back here after they allow access.
export async function GET(request: Request) {
  const issuer = issuerFor(request);
  const settings = new URL("/settings", issuer);
  const user = await getSession();
  if (!user) return NextResponse.redirect(new URL("/login", issuer));

  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  let nonce = "";
  try {
    nonce = JSON.parse(Buffer.from(params.get("state") || "", "base64url").toString()).nonce;
  } catch { /* checked below */ }
  const expected = (await cookies()).get("ynab-oauth")?.value;
  if (!code || !secretsEqual(nonce, expected)) {
    console.warn("[ynab-oauth] Callback with a missing code or a state that does not match");
    settings.searchParams.set("ynab", "failed");
    return NextResponse.redirect(settings);
  }
  try {
    await exchangeCode(code, issuer);
    settings.searchParams.set("ynab", "connected");
    console.info("[ynab-oauth] Signed in to YNAB for user", user.id);
  } catch (err) {
    console.error("[ynab-oauth]", err);
    settings.searchParams.set("ynab", "failed");
  }
  const response = NextResponse.redirect(settings);
  response.cookies.set("ynab-oauth", "", { maxAge: 0, path: "/api/ynab/oauth" });
  return response;
}
