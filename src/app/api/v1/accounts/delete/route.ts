import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { deleteAccount } from "@/lib/accounts-write";

// POST /api/v1/accounts/delete (write) - manual accounts are removed; synced accounts are closed.
// Body: { id }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const result = deleteAccount(String(body.id));
  if (!result.found) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return { success: true, closed: !!result.closed };
});
