import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { mergeRequest } from "@/lib/payees";

// POST /api/v1/payees/merge (write scope) - rename every transaction under the names in `from` to
// `into`. Body: { from: [name, ...], into: name }. A rename is a merge of one name. Local mode only.
export const POST = apiRoute("write", async (request) => {
  const result = mergeRequest(await request.json().catch(() => ({})));
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return { success: true, updated: result.updated };
});
