import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { updateInvestment } from "@/lib/investments-write";

// POST /api/v1/investments/update (write) - edit an investment override / re-value.
// Body: { ynab_account_id, monthly_contribution?, expected_return?, notes?, ticker?, value?, added?, init_contributed? }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!body.ynab_account_id) return NextResponse.json({ error: "ynab_account_id required" }, { status: 400 });
  const result = updateInvestment(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return { success: true };
});
