import { NextResponse } from "next/server";
import { issuerFor, SUPPORTED_SCOPES } from "@/lib/oauth";

// RFC 8414. A client points itself at an instance and reads this to learn where everything is, so
// nothing about a self-hosted Dough has to be configured in the client.
export function GET(request: Request) {
  const issuer = issuerFor(request);
  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Public clients only: a phone cannot keep a secret, so PKCE is the proof of possession.
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${issuer}/api-docs`,
  });
}
