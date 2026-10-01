import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSession } from "@/lib/auth";
import { issuerFor } from "@/lib/oauth";
import { authorizeUrl, makeState, ynabOAuthConfigured } from "@/lib/ynab/oauth";

// GET /api/ynab/oauth/start - off to YNAB to sign in and allow Dough to read and write the budget.
export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.redirect(new URL("/login", issuerFor(request)));
  if (!ynabOAuthConfigured()) return NextResponse.json({ error: "YNAB sign-in is not set up on this instance" }, { status: 404 });
  const nonce = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(authorizeUrl(issuerFor(request), makeState(issuerFor(request), nonce)));
  response.cookies.set("ynab-oauth", nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/ynab/oauth" });
  return response;
}
