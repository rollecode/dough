import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { reconcileAccount } from "@/lib/reconcile";

// Compare an account's recorded balance with the real bank balance the user types in, and use the
// AI to explain the difference over the last 7 days (duplicates to remove, or missing entries).
// The work is in lib/reconcile, which the v1 API calls too.
export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const accountId = String(body.account_id || "");
    const trueBalance = Number(body.true_balance);
    if (!accountId || !isFinite(trueBalance)) {
      return NextResponse.json({ error: "account_id and true_balance required" }, { status: 400 });
    }

    const account = getDb()
      .prepare("SELECT id, name, balance FROM ynab_accounts WHERE id = ?")
      .get(accountId) as { id: string; name: string; balance: number } | undefined;
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    return NextResponse.json(await reconcileAccount(account, trueBalance, String(body.locale || "en")));
  } catch (error) {
    console.error("[accounts/reconcile] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
