import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { respondToChat, type ChatUser } from "@/lib/ai/chat-respond";

// GET /api/v1/chat - the conversation so far, oldest first. ?limit= caps the page; the default is
// what a phone screen can scroll through without asking for more.
export const GET = apiRoute("read", (request, identity) => {
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50));
  const rows = getDb()
    .prepare(
      "SELECT m.id, m.role, m.content, m.created_at, u.display_name FROM chat_messages m " +
        "LEFT JOIN users u ON u.id = m.user_id WHERE m.user_id = ? OR m.role = 'assistant' " +
        "ORDER BY m.id DESC LIMIT ?"
    )
    .all(identity.userId, limit) as {
      id: number; role: string; content: string; created_at: string; display_name: string | null;
    }[];

  const messages = rows
    .reverse()
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      sender: m.display_name ?? "",
    }));

  return { messages, count: messages.length };
});

// POST /api/v1/chat { messages } - ask Dougie. The whole conversation is sent, the way the web page
// sends it, and the question and the answer are both kept so either client sees the same history.
export const POST = apiRoute("write", async (request, identity) => {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages (array) required" }, { status: 400 });
  }

  const db = getDb();
  const user = db
    .prepare("SELECT id, locale, display_name FROM users WHERE id = ?")
    .get(identity.userId) as ChatUser | undefined;

  const last = body.messages[body.messages.length - 1];
  if (last?.role === "user" && typeof last.content === "string") {
    db.prepare("INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)")
      .run(identity.userId, "user", last.content);
  }

  const message = await respondToChat(user ?? null, body);
  return { message };
});
