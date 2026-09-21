import { NextResponse } from "next/server";
import { login, COOKIE_NAME } from "@/lib/auth";
import { createLimiter, clientIp } from "@/lib/rate-limit";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = createLimiter(MAX_FAILURES, WINDOW_MS);

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const key = `${clientIp(request)}|${String(email).toLowerCase()}`;
    if (failures.isLimited(key)) {
      console.warn("[api/auth/login] Throttled login attempt for", email);
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }

    const result = await login(email, password);
    if (!result) {
      failures.record(key);
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    failures.reset(key);

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
