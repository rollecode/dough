import { NextResponse } from "next/server";
import { login, COOKIE_NAME } from "@/lib/auth";

// In-memory brute-force throttle. The app runs as a single Node process, so a process-local map
// is sufficient. Window resets on successful login; entries are pruned lazily.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, number[]>();

function clientKey(request: Request, email: string): string {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";
  return `${ip}|${email.toLowerCase()}`;
}

function isThrottled(key: string): boolean {
  const now = Date.now();
  const recent = (failures.get(key) || []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, recent);
  return recent.length >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const list = failures.get(key) || [];
  list.push(Date.now());
  failures.set(key, list);
  // Prune unrelated stale keys occasionally so the map cannot grow unboundedly
  if (failures.size > 1000) {
    const now = Date.now();
    for (const [k, v] of failures) {
      if (v.every((t) => now - t >= WINDOW_MS)) failures.delete(k);
    }
  }
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const key = clientKey(request, String(email));
    if (isThrottled(key)) {
      console.warn("[api/auth/login] Throttled login attempt for", email);
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }

    const result = await login(email, password);
    if (!result) {
      recordFailure(key);
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    failures.delete(key);

    const response = NextResponse.json({ user: result.user });
    response.cookies.set(COOKIE_NAME, result.token, {
      httpOnly: true,
      // HTTPS-only in production; local dev serves plain http so the flag would block login there
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[api/auth/login] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
