import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { reorderDebts } from "@/lib/debts-write";

// POST /api/v1/debts/reorder (write) - set debt display order. Body: { order: [ynab_account_id, ...] }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.order)) return NextResponse.json({ error: "order array required" }, { status: 400 });
  reorderDebts(body.order.map(String));
  return { success: true };
});
