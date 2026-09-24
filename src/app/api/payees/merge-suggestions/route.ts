import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { payeeUsage, SUGGESTION_POOL } from "@/lib/payees";
import { suggestPayeeMerges } from "@/lib/ai/payee-merge";

// The web's merge suggestions, the same as GET /api/v1/payees/merge-suggestions.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ groups: await suggestPayeeMerges(payeeUsage(SUGGESTION_POOL)) });
}
