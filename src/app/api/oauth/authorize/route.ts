import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClient, redirectUriAllowed, normaliseScopes, issueCode, isS256Challenge } from "@/lib/oauth";

// The consent form posts here. The session cookie is what proves who is granting access, so this
// only ever acts for the person currently signed in on this browser.
export async function POST(request: Request) {
  const form = await request.formData();
  const clientId = String(form.get("client_id") || "");
  const redirectUri = String(form.get("redirect_uri") || "");
  const state = String(form.get("state") || "");
  const codeChallenge = String(form.get("code_challenge") || "");
  const codeChallengeMethod = String(form.get("code_challenge_method") || "");
  const decision = String(form.get("decision") || "deny");
  const scopes = normaliseScopes(String(form.get("scope") || ""));

  const client = getClient(clientId);
  if (!client || !redirectUriAllowed(client, redirectUri) || !isS256Challenge(codeChallengeMethod, codeChallenge)) {
    console.warn("[oauth] Consent posted with an unusable client, redirect URI or PKCE challenge");
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const user = await getSession();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);

  const target = new URL(redirectUri);
  if (state) target.searchParams.set("state", state);

  if (decision !== "allow") {
    console.info("[oauth] Consent denied for client", clientId);
    target.searchParams.set("error", "access_denied");
    return NextResponse.redirect(target.toString(), 303);
  }

  const code = issueCode({
    clientId,
    userId: user.id,
    redirectUri,
    scopes,
    codeChallenge,
  });
  target.searchParams.set("code", code);
  return NextResponse.redirect(target.toString(), 303);
}
