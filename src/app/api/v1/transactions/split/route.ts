import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { getBudgetMode } from "@/lib/household";
import { splitTransaction } from "@/lib/split-transaction";

// POST /api/v1/transactions/split (write) - spread one transaction across several categories.
// Body: { transaction_id, splits: [{ category, amount }] } with positive amounts. One split
// collapses it back to a single categorised row. Local mode only, as the other writes are.
export const POST = apiRoute("write", async (request, identity) => {
  if (getBudgetMode() !== "local") {
    return NextResponse.json({ error: "Transaction writes are only available in local mode" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const result = splitTransaction(
    identity.userId,
    String(body.transaction_id || ""),
    Array.isArray(body.splits) ? body.splits : []
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.code });
  }
  return { success: true, parts: result.parts };
});
