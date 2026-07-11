import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { getBudgetMode } from "@/lib/household";
import { createLocalTransaction } from "@/lib/local-transactions";

// POST /api/v1/transactions/create (write scope) - add a new transaction to Dough's local ledger and
// apply its balance effect. Body:
// { account_id, amount, inflow?, date?, payee_name?, memo?, category?, cleared?, transfer_account_id? }
// amount is the absolute value; inflow defaults to false (money out). Intended for rows Synci has not
// imported yet - most importantly pending card holds (varaukset), so Dough matches the bank's
// available balance to the cent. Setting category to "Internal transfer" with a transfer_account_id
// creates the counterpart leg. Local mode only: in YNAB mode transactions are owned by YNAB.
export const POST = apiRoute("write", async (request, identity) => {
  if (getBudgetMode() !== "local") {
    return NextResponse.json({ error: "Transaction writes are only available in local mode" }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const account_id = String(body.account_id || "");
  if (!account_id) {
    return NextResponse.json({ error: "account_id required" }, { status: 400 });
  }
  if (body.amount === undefined || !isFinite(parseFloat(String(body.amount)))) {
    return NextResponse.json({ error: "amount must be a number" }, { status: 400 });
  }
  if (body.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const result = createLocalTransaction(identity.userId, {
    account_id,
    amount: body.amount,
    inflow: typeof body.inflow === "boolean" ? body.inflow : undefined,
    date: body.date ? String(body.date) : undefined,
    payee_name: body.payee_name !== undefined ? String(body.payee_name) : undefined,
    memo: body.memo !== undefined ? String(body.memo) : undefined,
    category: body.category !== undefined ? String(body.category) : undefined,
    cleared: body.cleared !== undefined ? String(body.cleared) : undefined,
    transfer_account_id: body.transfer_account_id ? String(body.transfer_account_id) : undefined,
    budget_excluded: typeof body.budget_excluded === "boolean" ? body.budget_excluded : undefined,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return { success: true, transaction_id: result.id };
});
