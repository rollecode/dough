import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { updateIncome } from "@/lib/income-write";

// POST /api/v1/income/update (write). Body: { id, name?, amount?, expected_day?, is_recurring?, is_active?, target_account_id?, mark_received? }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const result = updateIncome(body);
  if (!result.found) return NextResponse.json({ error: "Income source not found" }, { status: 404 });
  return { success: true };
});
