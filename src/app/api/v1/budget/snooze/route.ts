import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { snoozeCategory } from "@/lib/budget-writes";

// POST /api/v1/budget/snooze (write) - snooze a category for a month. Body: { category_id, month }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const result = snoozeCategory(body.category_id, body.month);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return { success: true };
});
