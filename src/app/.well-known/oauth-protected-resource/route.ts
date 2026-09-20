import { NextResponse } from "next/server";
import { issuerFor, SUPPORTED_SCOPES } from "@/lib/oauth";

// RFC 9728. Says which authorization server guards this API, which for a self-hosted instance is
// always itself.
export function GET(request: Request) {
  const issuer = issuerFor(request);
  return NextResponse.json({
    resource: `${issuer}/api/v1`,
    authorization_servers: [issuer],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${issuer}/api-docs`,
  });
}
