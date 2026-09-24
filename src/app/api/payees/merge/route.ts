import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { mergeRequest } from "@/lib/payees";

// The web's payee merge, the same write as POST /api/v1/payees/merge.
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const result = mergeRequest(await request.json().catch(() => ({})));
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true, updated: result.updated });
}
