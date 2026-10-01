import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const db = getDb();

    if (body.locale) {
      console.info("[api/auth/update] Updating locale for user", user.id, "to", body.locale);
      db.prepare("UPDATE users SET locale = ?, updated_at = datetime('now') WHERE id = ?")
        .run(body.locale, user.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/auth/update] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
