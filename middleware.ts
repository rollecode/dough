import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Fail closed: never fall back to a default secret from this public repository.
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}
const JWT_SECRET = new TextEncoder().encode(process.env.SESSION_SECRET);
const COOKIE_NAME = "dough-session";

// The reference is served on the api. subdomain of whatever domain an instance runs on, so every
// self-hosted Dough has its own docs at its own address with nothing to configure. DOUGH_DOCS_HOST
// pins an exact host instead, for an instance that already lives on an api. name.
function isDocsHost(host: string): boolean {
  const pinned = process.env.DOUGH_DOCS_HOST;
  if (pinned) return host === pinned;
  return host === "api.localhost:3000" || /^api\./.test(host);
}

// Paths the docs host serves itself: the page's own assets, and the key-authed public API, so a
// client can call the API on the same host the reference documents. The cookie-authed internal
// routes are deliberately not here - this host skips the session gate, so only routes that
// authenticate inside themselves may answer on it. Everything else belongs to the app and is sent
// to the app's own host rather than resolving to the reference again.
const DOCS_PASSTHROUGH = ["/_next", "/api/v1", "/favicon", "/icon", "/apple", "/manifest"];

function serveDocs(request: NextRequest, host: string) {
  const { pathname, search } = request.nextUrl;

  if (DOCS_PASSTHROUGH.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  if (pathname === "/" || pathname === "/api-docs") {
    const url = request.nextUrl.clone();
    url.pathname = "/api-docs";
    return NextResponse.rewrite(url);
  }

  const appHost = host.replace(/^api\./, "");
  const scheme = request.nextUrl.protocol === "http:" ? "http" : "https";
  return NextResponse.redirect(`${scheme}://${appHost}${pathname}${search}`, 308);
}

export async function middleware(request: NextRequest) {
  // The docs host is public: it never reads the database and must not be sent to /login.
  const host = request.headers.get("host") || "";
  if (isDocsHost(host)) {
    return serveDocs(request, host);
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const isLoginPage = request.nextUrl.pathname.startsWith("/login");
  const isApiAuth = request.nextUrl.pathname.startsWith("/api/auth");
  const isEvents = request.nextUrl.pathname === "/api/events";
  // The reference is public wherever it is asked for: it holds no data, only the API's shape.
  const isApiDocs = request.nextUrl.pathname === "/api-docs";
  const isSynciSync = request.nextUrl.pathname === "/api/synci/sync";
  // The public v1 API authenticates with an API key inside each route (see lib/api-auth), not the
  // session cookie, so it must bypass this cookie gate and never be redirected to /login.
  const isApiV1 = request.nextUrl.pathname.startsWith("/api/v1");

  // Allow auth API, the key-authed public API, SSE events, cron endpoints, and static assets
  if (isApiAuth || isApiV1 || isApiDocs || isEvents || isSynciSync) {
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
