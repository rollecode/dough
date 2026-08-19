import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { updateSavingsGoal } from "@/lib/savings-goals-write";

// POST /api/v1/savings-goals/update (write) - edit a goal by id. Only provided fields change.
// Body: { id, name?, target_amount?, saved_amount?, ynab_category_id?, ynab_category_name?, target_date?, description?, include_in_calculations?, is_active? }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const result = updateSavingsGoal(body);
  if (!result.found) return NextResponse.json({ error: "Savings goal not found" }, { status: 404 });
  return { success: true };
});
