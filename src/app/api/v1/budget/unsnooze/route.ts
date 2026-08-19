import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { unsnoozeCategory } from "@/lib/budget-writes";

// POST /api/v1/budget/unsnooze (write) - remove a category's snooze for a month. Body: { category_id, month }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const result = unsnoozeCategory(body.category_id, body.month);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return { success: true };
});
