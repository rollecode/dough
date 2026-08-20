import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { createIncome } from "@/lib/income-write";

// POST /api/v1/income/create (write). Body: { name, amount, expected_day, is_recurring?, target_account_id? }
export const POST = apiRoute("write", async (request, identity) => {
  const body = await request.json().catch(() => ({}));
  const result = createIncome(identity.userId, body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return { success: true, id: result.id };
});
