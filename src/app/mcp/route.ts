import { NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateApiKey } from "@/lib/api-auth";
import { issuerFor } from "@/lib/oauth";
import { buildMcpServer } from "@/lib/mcp/tools";
import { inProcessApi } from "@/lib/mcp/api";

// Every instance is its own MCP server at /mcp, signed in with the instance's own OAuth or an API
// key, so each person connects as themselves and sees what their account can see.

function unauthorized(request: Request) {
  const metadata = `${issuerFor(request)}/.well-known/oauth-protected-resource/mcp`;
  return NextResponse.json(
    { error: "Sign in to this Dough to use its MCP server" },
    { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadata}"` } }
  );
}

// Stateless: a fresh server per request, so nothing has to survive between requests or processes.
export async function POST(request: Request) {
  const identity = authenticateApiKey(request);
  if (!identity) {
    console.warn("[mcp] Rejected request without a valid token");
    return unauthorized(request);
  }

  console.debug("[mcp] Request from user", identity.userId, "scopes", identity.scopes.join("|"));
  const authorization = request.headers.get("authorization") || `Bearer ${request.headers.get("x-api-key")}`;
  const server = buildMcpServer(inProcessApi(issuerFor(request), authorization));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

// Without sessions there is no stream to open or close.
function methodNotAllowed() {
  return NextResponse.json({ error: "Use POST" }, { status: 405, headers: { Allow: "POST" } });
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
