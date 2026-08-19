import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { createCategory } from "@/lib/categories-write";

// POST /api/v1/categories/create (write) - add a budget category. Body: { name, group_name?, color? }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const result = createCategory(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.code || 400 });
  return { success: true, id: result.id };
});
