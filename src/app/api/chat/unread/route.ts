import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { chatUnread, markChatSeen } from "@/lib/badges";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ unread: 0 });
    return NextResponse.json({ unread: chatUnread(getDb(), user.id) });
  } catch (error) {
    console.error("[chat/unread] Error:", error);
    return NextResponse.json({ unread: 0 });
  }
}

export async function POST() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    markChatSeen(getDb(), user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[chat/unread] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
