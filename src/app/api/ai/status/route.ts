import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { aiStatus } from "@/lib/ai/status";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json(aiStatus());
}
