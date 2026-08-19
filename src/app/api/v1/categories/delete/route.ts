import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { deleteCategory } from "@/lib/categories-write";

// POST /api/v1/categories/delete (write) - delete a category. If it has transactions, reassign_to
// (another category id) is required; its monthly budgets merge into that target. Body: { id, reassign_to? }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const result = deleteCategory(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.code || 400 });
  if (!result.found) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  return { success: true, reassigned: result.reassigned };
});
