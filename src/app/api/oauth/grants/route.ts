import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listGrants } from "@/lib/oauth";

// GET /api/oauth/grants - the apps the signed-in person has let in through OAuth.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ grants: listGrants(user.id) });
}
