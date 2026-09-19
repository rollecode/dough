import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const MAX_BODY = 4000;

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = (await request.text()).slice(0, MAX_BODY);
  console.warn("[overflow] user", user.id, body);
  return NextResponse.json({ ok: true });
}
