import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { updateDebtOverride } from "@/lib/debts-write";

// POST /api/v1/debts/update (write) - set a debt's override fields (identify by ynab_account_id).
// Body: { ynab_account_id, interest_rate?, minimum_payment?, due_day?, notes?, original_amount?, is_priority? }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!body.ynab_account_id) return NextResponse.json({ error: "ynab_account_id required" }, { status: 400 });
  const result = updateDebtOverride(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return { success: true };
});
