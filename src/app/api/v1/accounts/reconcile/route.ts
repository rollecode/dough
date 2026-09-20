import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { reconcileAccount } from "@/lib/reconcile";

// POST /api/v1/accounts/reconcile (read scope: nothing is written) - compare what Dough thinks an
// account holds with what the bank says, and get the days' transactions that explain the gap.
// Body: { account_id, true_balance, locale? }
export const POST = apiRoute("read", async (request) => {
  const body = await request.json().catch(() => ({}));
  const accountId = String(body.account_id || "");
  const trueBalance = Number(body.true_balance);
  if (!accountId || !isFinite(trueBalance)) {
    return NextResponse.json({ error: "account_id and true_balance required" }, { status: 400 });
  }

  const account = getDb()
    .prepare("SELECT id, name, balance FROM ynab_accounts WHERE id = ?")
    .get(accountId) as { id: string; name: string; balance: number } | undefined;
  if (!account) return NextResponse.json({ error: `No account with id ${accountId}` }, { status: 404 });

  return reconcileAccount(account, trueBalance, String(body.locale || "en"));
});
