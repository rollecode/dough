import { NextResponse } from "next/server";
import { getSession, COOKIE_NAME } from "@/lib/auth";
import { deleteAccount } from "@/lib/account";

// POST /api/account/delete { password } - deletes the signed-in person's account, and the household
// with it when they are its last member.
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  const outcome = await deleteAccount(user.id, String(password ?? ""));
  if (outcome === "wrong-password") return NextResponse.json({ error: "Wrong password" }, { status: 403 });
  const response = NextResponse.json({ deleted: outcome });
  response.cookies.set(COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/" });
  return response;
}
