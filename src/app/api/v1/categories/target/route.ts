import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { setCategoryTarget, clearCategoryTarget } from "@/lib/categories-write";

// POST /api/v1/categories/target (write) - set or clear a category's budget target.
// Body to set: { category_id, monthly_amount, cadence? (daily|weekly|monthly|yearly|by_date), target_date?, snooze_until_month? }
// Body to clear: { category_id, clear: true }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const result = body.clear === true ? clearCategoryTarget(Number(body.category_id)) : setCategoryTarget(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.code || 400 });
  return { success: true };
});
