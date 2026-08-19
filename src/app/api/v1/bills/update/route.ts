import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { updateBill } from "@/lib/bills-write";

// POST /api/v1/bills/update (write) - edit a bill by id. Only provided fields change.
// Body: { id, name?, amount?, due_day?, category?, cadence?, due_month?, is_priority?, is_active?, mark_paid?, paid_amount? }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const result = updateBill(body);
  if (!result.found) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  return { success: true };
});
