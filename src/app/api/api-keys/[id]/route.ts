import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

// DELETE /api/api-keys/[id] - revoke a key. Revoked rather than deleted, so the row still explains
// what a key was when someone asks why a client stopped working. A key stops authenticating on its
// next request. Scoped to the owner, so one user cannot revoke another's key.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const result = getDb()
    .prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .run(Number(id), user.id);

  if (result.changes === 0) {
    console.warn("[api-keys] Nothing to revoke for id", id);
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  console.info("[api-keys] Revoked key", id);
  return NextResponse.json({ success: true });
}
