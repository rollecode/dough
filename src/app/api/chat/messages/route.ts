import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

/* eslint-disable @typescript-eslint/no-explicit-any */

function loadReactions(db: any, messageIds: number[], userId: number) {
  if (messageIds.length === 0) return {};
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT r.message_id, r.emoji, COUNT(*) as count, GROUP_CONCAT(u.display_name) as users
    FROM chat_reactions r
    JOIN users u ON u.id = r.user_id
    WHERE r.message_id IN (${placeholders})
    GROUP BY r.message_id, r.emoji
  `).all(...messageIds) as { message_id: number; emoji: string; count: number; users: string }[];

  const myRows = db.prepare(`
    SELECT message_id, emoji FROM chat_reactions WHERE message_id IN (${placeholders}) AND user_id = ?
  `).all(...messageIds, userId) as { message_id: number; emoji: string }[];
  const mySet = new Set(myRows.map((r) => `${r.message_id}_${r.emoji}`));

  const result: Record<number, { emoji: string; count: number; users: string[]; mine: boolean }[]> = {};
  for (const row of rows) {
    if (!result[row.message_id]) result[row.message_id] = [];
    result[row.message_id].push({
      emoji: row.emoji,
      count: row.count,
      users: row.users.split(","),
      mine: mySet.has(`${row.message_id}_${row.emoji}`),
    });
  }
  return result;
}

export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ messages: [] }, { status: 401 });
    }

    const db = getDb();
    const url = new URL(request.url);
    const before = url.searchParams.get("before");

    if (before) {
      // Load one day's worth of messages before the given ID
      const ref = db.prepare("SELECT created_at FROM chat_messages WHERE id = ?").get(parseInt(before, 10)) as { created_at: string } | undefined;
      if (!ref) return NextResponse.json({ messages: [], hasOlder: false });

      // Get the date of the reference message, load all messages from that day
      const refDate = ref.created_at.slice(0, 10);
      const messages = db
        .prepare("SELECT cm.id, cm.role, cm.content, cm.created_at, cm.image_thumb, u.display_name as sender FROM chat_messages cm LEFT JOIN users u ON cm.user_id = u.id WHERE cm.created_at < ? ORDER BY cm.created_at ASC")
        .all(refDate + " 00:00:00") as { id: number; role: string; content: string; created_at: string; image_thumb: string | null; sender: string }[];

      // Find the natural day boundary — get the latest day in this batch
      const days = [...new Set(messages.map((m) => m.created_at.slice(0, 10)))].sort();
      const latestDay = days[days.length - 1];
      const dayMessages = latestDay ? messages.filter((m) => m.created_at.slice(0, 10) === latestDay) : [];
      const hasOlder = messages.length > dayMessages.length;

      const olderReactions = loadReactions(db, dayMessages.map((m) => m.id), user.id);
      console.debug("[chat/messages] Loaded", dayMessages.length, "older messages for day", latestDay, "hasOlder:", hasOlder);
      return NextResponse.json({ messages: dayMessages, hasOlder, reactions: olderReactions });
    }

    // Default: load today's messages. If none today, load the most recent day's messages.
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    let messages = db
      .prepare("SELECT cm.id, cm.role, cm.content, cm.created_at, cm.image_thumb, u.display_name as sender FROM chat_messages cm LEFT JOIN users u ON cm.user_id = u.id WHERE cm.created_at >= ? ORDER BY cm.created_at ASC")
      .all(todayStr + " 00:00:00") as { id: number; role: string; content: string; created_at: string; image_thumb: string | null; sender: string }[];

    if (messages.length === 0) {
      // No messages today — load the most recent day that has messages
      const lastMsg = db.prepare("SELECT created_at FROM chat_messages ORDER BY created_at DESC LIMIT 1").get() as { created_at: string } | undefined;
      if (lastMsg) {
        const lastDay = lastMsg.created_at.slice(0, 10);
        messages = db
          .prepare("SELECT cm.id, cm.role, cm.content, cm.created_at, cm.image_thumb, u.display_name as sender FROM chat_messages cm LEFT JOIN users u ON cm.user_id = u.id WHERE cm.created_at >= ? AND cm.created_at < ? ORDER BY cm.created_at ASC")
          .all(lastDay + " 00:00:00", lastDay + " 23:59:59") as { id: number; role: string; content: string; created_at: string; image_thumb: string | null; sender: string }[];
      }
    }

    // Check if there are older messages
    const oldestLoaded = messages.length > 0 ? messages[0].id : null;
    const hasOlder = oldestLoaded
      ? !!(db.prepare("SELECT id FROM chat_messages WHERE id < ? LIMIT 1").get(oldestLoaded))
      : false;

    const reactions = loadReactions(db, messages.map((m) => m.id), user.id);
    console.debug("[chat/messages] Loaded", messages.length, "messages, hasOlder:", hasOlder);
    return NextResponse.json({ messages, hasOlder, reactions });
  } catch (error) {
    console.error("[chat/messages] GET error:", error);
    return NextResponse.json({ messages: [] }, { status: 500 });
  }
}

// A thumbnail for the chat history, not the attachment itself.
const MAX_THUMB_LENGTH = 500_000;

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { role, content, image_thumb } = await request.json();

    if (!role || !content) {
      return NextResponse.json({ error: "Role and content required" }, { status: 400 });
    }
    if (role !== "user" && role !== "assistant") {
      return NextResponse.json({ error: "Role must be user or assistant" }, { status: 400 });
    }
    if (image_thumb && (typeof image_thumb !== "string" || image_thumb.length > MAX_THUMB_LENGTH || !(image_thumb === "pdf" || image_thumb.startsWith("data:image/")))) {
      return NextResponse.json({ error: "image_thumb must be \"pdf\" or a small data:image URL" }, { status: 400 });
    }

    const db = getDb();
    const result = db
      .prepare("INSERT INTO chat_messages (user_id, role, content, image_thumb) VALUES (?, ?, ?, ?)")
      .run(user.id, role, content, image_thumb || null);

    console.debug("[chat/messages] Saved", role, "message for user", user.id, "id:", result.lastInsertRowid);

    // Broadcast to all SSE clients
    eventBus.emit("chat:message", {
      id: result.lastInsertRowid,
      role,
      content,
      sender: user.display_name || user.email,
      userId: user.id,
    });

    return NextResponse.json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error("[chat/messages] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const db = getDb();
    db.prepare("DELETE FROM chat_messages").run();

    console.info("[chat/messages] Cleared all shared chat messages");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[chat/messages] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
