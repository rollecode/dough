import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { updateCategory } from "@/lib/categories-write";

// POST /api/v1/categories/update (write) - edit a category by id (name, group, color, is_active, or
// link it to a subscription/bill/debt_account/savings_goal/investment_account). Body: { id, ...fields }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const result = updateCategory(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.code || 400 });
  if (!result.found) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  return { success: true };
});
