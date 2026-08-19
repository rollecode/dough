import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { reorderInvestments } from "@/lib/investments-write";

// POST /api/v1/investments/reorder (write) - set display order. Body: { order: string[] } (account ids)
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.order)) return NextResponse.json({ error: "order array required" }, { status: 400 });
  reorderInvestments(body.order);
  return { success: true };
});
