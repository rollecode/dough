import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Fail closed: never fall back to a default secret from this public repository.
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}
const JWT_SECRET = new TextEncoder().encode(process.env.SESSION_SECRET);
const COOKIE_NAME = "dough-session";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const isLoginPage = request.nextUrl.pathname.startsWith("/login");
  const isApiAuth = request.nextUrl.pathname.startsWith("/api/auth");
  const isEvents = request.nextUrl.pathname === "/api/events";
  const isSynciSync = request.nextUrl.pathname === "/api/synci/sync";
  // The public v1 API authenticates with an API key inside each route (see lib/api-auth), not the
  // session cookie, so it must bypass this cookie gate and never be redirected to /login.
  const isApiV1 = request.nextUrl.pathname.startsWith("/api/v1");

  // Allow auth API, the key-authed public API, SSE events, cron endpoints, and static assets
  if (isApiAuth || isApiV1 || isEvents || isSynciSync) {
    return NextResponse.next();
  }

  // Check session
  let isValid = false;
  if (token) {
    try {
      await jwtVerify(token, JWT_SECRET);
      isValid = true;
    } catch {
      isValid = false;
    }
  }

  // Redirect unauthenticated to login
  if (!isValid && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated away from login
  if (isValid && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Only manifest.json is exempt by name - a blanket *.json exemption would let any future
    // .json route or static file bypass the auth gate.
    "/((?!_next/static|_next/image|favicon\\.ico|favicon\\.png|manifest\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
