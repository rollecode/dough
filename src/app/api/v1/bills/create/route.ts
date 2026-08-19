import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { createBill } from "@/lib/bills-write";

// POST /api/v1/bills/create (write) - add a recurring bill.
// Body: { name, amount, due_day, category?, cadence? ("monthly"|"yearly"), due_month? (1-12, yearly) }
export const POST = apiRoute("write", async (request, identity) => {
  const body = await request.json().catch(() => ({}));
  const result = createBill(identity.userId, body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return { success: true, id: result.id };
});
