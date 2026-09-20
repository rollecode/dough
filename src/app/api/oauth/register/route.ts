import { NextResponse } from "next/server";
import { registerClient, isAcceptableRedirectUri } from "@/lib/oauth";

// RFC 7591, open registration. A self-hoster should never have to paste a client id into an app, so
// any client may register; what it gets is an identifier, not a credential, and it still cannot
// receive a code anywhere except the redirect URI it registered.
export async function POST(request: Request) {
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
        { error: "invalid_redirect_uri", error_description: "redirect URIs must be a private scheme or loopback" },
        { status: 400 }
      );
    }
  }

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
