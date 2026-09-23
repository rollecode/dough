import { NextResponse } from "next/server";
import { registerClient, isAcceptableRedirectUri } from "@/lib/oauth";
import { createLimiter, clientIp } from "@/lib/rate-limit";

const MAX_REGISTRATIONS = 10;
const WINDOW_MS = 60 * 60 * 1000;
const registrations = createLimiter(MAX_REGISTRATIONS, WINDOW_MS);

// RFC 7591, open registration. A self-hoster should never have to paste a client id into an app, so
// any client may register; what it gets is an identifier, not a credential, and it still cannot
// receive a code anywhere except the redirect URI it registered.
export async function POST(request: Request) {
  const ip = clientIp(request);
  if (registrations.isLimited(ip)) {
    console.warn("[oauth] Throttled client registration from", ip);
    return NextResponse.json({ error: "too_many_requests", error_description: "Too many registrations. Try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.client_name || "").trim();
  const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];

  if (!name) {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "client_name required" }, { status: 400 });
  }
  if (redirectUris.length === 0) {
    return NextResponse.json({ error: "invalid_redirect_uri", error_description: "redirect_uris required" }, { status: 400 });
  }
  for (const uri of redirectUris) {
    if (!isAcceptableRedirectUri(uri)) {
      console.warn("[oauth] Refused registration for redirect URI", uri);
      return NextResponse.json(
        { error: "invalid_redirect_uri", error_description: "redirect URIs must be https, an app scheme or loopback" },
        { status: 400 }
      );
    }
  }

  registrations.record(ip);
  const client = registerClient(name, redirectUris);
  return NextResponse.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 }
  );
}
