import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";

function buildLogoutResponse(request: Request) {
  // Use the host from the request headers to build correct redirect URL
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3001";
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const redirectUrl = `${proto}://${host}/login`;

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  console.info("[api/auth/logout] User logged out, redirecting to", redirectUrl);
  return response;
}

export async function GET(request: Request) {
  return buildLogoutResponse(request);
}

export async function POST(request: Request) {
  return buildLogoutResponse(request);
}
