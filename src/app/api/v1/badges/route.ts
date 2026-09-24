import { NextResponse } from "next/server";
import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { overspentCategories, transactionsUnread, markTransactionsSeen, chatUnread, markChatSeen } from "@/lib/badges";

// GET /api/v1/badges - the web sidebar's notice dots, for another client's tab bar: overspent
// categories this month, whether a transaction was added by hand since the key's user last looked,
// and chat messages from others since then.
export const GET = apiRoute("read", (request, identity) => {
  const db = getDb();
  return {
    budget_overspent: overspentCategories(db, resolveMonth(request)),
    transactions_unread: transactionsUnread(db, identity.userId),
    chat_unread: chatUnread(db, identity.userId),
  };
});

// POST /api/v1/badges { seen: "transactions" | "chat" } (write scope) - clear a dot when its screen
// is opened. The budget dot is a state and clears only when nothing is overspent.
export const POST = apiRoute("write", async (request, identity) => {
  const { seen } = await request.json().catch(() => ({}));
  const db = getDb();
  if (seen === "transactions") markTransactionsSeen(db, identity.userId);
  else if (seen === "chat") markChatSeen(db, identity.userId);
  else return NextResponse.json({ error: "seen must be transactions or chat" }, { status: 400 });
  return { success: true };
});
