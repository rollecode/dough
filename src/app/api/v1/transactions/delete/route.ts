import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { getBudgetMode } from "@/lib/household";
import { deleteLocalTransaction } from "@/lib/local-transactions";

// POST /api/v1/transactions/delete (write scope) - remove one transaction by id (split siblings
// go with it) and reverse its balance effect. Body: { transaction_id }. Local mode only.
export const POST = apiRoute("write", async (request, identity) => {
  if (getBudgetMode() !== "local") {
    return NextResponse.json({ error: "Transaction writes are only available in local mode" }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const transaction_id = String(body.transaction_id || "");
  if (!transaction_id) {
    return NextResponse.json({ error: "transaction_id required" }, { status: 400 });
  }
  const result = deleteLocalTransaction(identity.userId, transaction_id);
  if (!result.found) {
    return NextResponse.json({ error: `No transaction with id ${transaction_id}` }, { status: 404 });
  }
  return { success: true, transaction_id };
});
