import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revokeGrant } from "@/lib/oauth";

// DELETE /api/oauth/grants/[clientId] - sign one app out: every token it holds for this person ends.
export async function DELETE(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { clientId } = await params;
  if (revokeGrant(user.id, clientId) === 0) {
    return NextResponse.json({ error: "No such connected app" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
