import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { createAccount } from "@/lib/accounts-write";

// POST /api/v1/accounts/create (write) - add a manual account.
// Body: { name, type? (default "checking"), balance? (seeds balance+cleared), on_budget? (default true) }
export const POST = apiRoute("write", async (request, identity) => {
  const body = await request.json().catch(() => ({}));
  const result = createAccount(identity.userId, body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return { success: true, id: result.id };
});
