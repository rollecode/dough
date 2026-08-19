import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { createSavingsGoal } from "@/lib/savings-goals-write";

// POST /api/v1/savings-goals/create (write) - add a savings goal, optionally linked to a budget
// category. Body: { name, target_amount, ynab_category_id?, ynab_category_name?, target_date?, description? }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const result = createSavingsGoal(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return { success: true, id: result.id };
});
