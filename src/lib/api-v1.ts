import { NextResponse } from "next/server";
import { authorize, type ApiKeyIdentity } from "./api-auth";
import { localDateIso } from "./date-utils";

// Thin wrapper for /api/v1/* route handlers: enforces API-key auth for the given scope, serialises
// the handler's return value to JSON, and turns thrown errors into a 500. Keeps every v1 route down
// to its actual query logic without repeating the auth/JSON/error boilerplate.
export function apiRoute(
  scope: "read" | "write",
  handler: (request: Request, identity: ApiKeyIdentity) => Promise<unknown> | unknown
) {
  return async (request: Request) => {
    const auth = authorize(request, scope);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
    }
    try {
      const data = await handler(request, auth.identity);
      // A handler may return a NextResponse directly (e.g. a 400 for a bad body); pass it through.
      if (data instanceof NextResponse) return data;
      return NextResponse.json(data);
    } catch (error) {
      console.error("[api/v1] Handler error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

// The current calendar month (YYYY-MM) in the server's Helsinki timezone, or an explicit &month=
// query param when it is a valid YYYY-MM. Shared so every v1 endpoint resolves "this month" the same.
export function resolveMonth(request: Request): string {
  const raw = new URL(request.url).searchParams.get("month");
  if (raw && /^\d{4}-\d{2}$/.test(raw)) return raw;
  return localDateIso().slice(0, 7);
}
