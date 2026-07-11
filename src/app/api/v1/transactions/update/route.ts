import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { getBudgetMode } from "@/lib/household";
import { updateLocalTransaction } from "@/lib/local-transactions";

// POST /api/v1/transactions/update (write scope) - patch one transaction by its id (the id the
// list/read endpoints return). Only provided fields change. Body:
// { transaction_id, amount?, inflow?, payee_name?, memo?, account_id?, date?, category?, transfer_account_id? }
// amount is the absolute value; inflow=true stores it positive. Setting category to
// "Internal transfer" with a transfer_account_id fills the counterpart account and maintains the
// opposite leg, so a misrouted transfer can be fixed in one call. Local mode only: in YNAB mode
// transactions are owned by YNAB and must be edited there.
export const POST = apiRoute("write", async (request, identity) => {
  if (getBudgetMode() !== "local") {
    return NextResponse.json({ error: "Transaction writes are only available in local mode" }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const transaction_id = String(body.transaction_id || "");
  if (!transaction_id) {
    return NextResponse.json({ error: "transaction_id required" }, { status: 400 });
  }
  if (body.amount !== undefined && !isFinite(parseFloat(String(body.amount)))) {
    return NextResponse.json({ error: "amount must be a number" }, { status: 400 });
  }
  if (body.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const result = updateLocalTransaction(identity.userId, {
    transaction_id,
    amount: body.amount,
    inflow: typeof body.inflow === "boolean" ? body.inflow : undefined,
    payee_name: body.payee_name !== undefined ? String(body.payee_name) : undefined,
    memo: body.memo !== undefined ? String(body.memo) : undefined,
    account_id: body.account_id ? String(body.account_id) : undefined,
    date: body.date ? String(body.date) : undefined,
    category: body.category !== undefined ? String(body.category) : undefined,
    transfer_account_id: body.transfer_account_id ? String(body.transfer_account_id) : undefined,
    budget_excluded: typeof body.budget_excluded === "boolean" ? body.budget_excluded : undefined,
  });
  if (!result.found) {
    return NextResponse.json({ error: `No transaction with id ${transaction_id}` }, { status: 404 });
  }
  return { success: true, transaction_id };
});
