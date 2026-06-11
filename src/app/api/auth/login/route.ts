import { NextResponse } from "next/server";
import { login, COOKIE_NAME } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const result = await login(email, password);
    if (!result) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

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
