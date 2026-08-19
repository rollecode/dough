import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { updateAccount } from "@/lib/accounts-write";

// POST /api/v1/accounts/update (write) - edit an account by id. Only provided fields change. Setting
// balance records a reconciliation transaction so history matches.
// Body: { id, name?, type?, balance?, on_budget?, closed?, sort_order? }
export const POST = apiRoute("write", async (request, identity) => {
  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const result = updateAccount(identity.userId, body);
  if (!result.found) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return { success: true };
});
