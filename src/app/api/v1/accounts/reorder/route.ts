import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { reorderAccounts } from "@/lib/accounts-write";

// POST /api/v1/accounts/reorder (write) - set the order accounts are listed in. Body: { order: [id, ...] }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.order)) return NextResponse.json({ error: "order array required" }, { status: 400 });
  reorderAccounts(body.order.map(String));
  return { success: true };
});
