import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { moveBudget } from "@/lib/budget-writes";

// POST /api/v1/budget/move (write) - move assigned money between categories in a month.
// Body: { month, from_category_id, to_category_id, amount }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const result = moveBudget(body);
  if ("error" in result) return NextResponse.json({ error: result.error, available: result.available }, { status: 400 });
  return { success: true, moved: result.moved };
});
