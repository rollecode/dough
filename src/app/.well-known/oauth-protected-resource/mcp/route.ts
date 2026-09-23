import { NextResponse } from "next/server";
import { issuerFor, SUPPORTED_SCOPES } from "@/lib/oauth";

// RFC 9728 for the MCP endpoint. A client checks that this resource matches the server it connects
// to, so /mcp needs its own document next to the /api/v1 one.
export function GET(request: Request) {
  const issuer = issuerFor(request);
  return NextResponse.json({
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${issuer}/api-docs`,
  });
}
