import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { respondToChat } from "@/lib/ai/chat-respond";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: "Messages array is required" }, { status: 400 });
    }

    const user = await getSession();
    const message = await respondToChat(user, body, request);
    return NextResponse.json({ message });
  } catch (error) {
    console.error("[chat] API error:", error);
    return NextResponse.json(
      { message: "Sorry, something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
