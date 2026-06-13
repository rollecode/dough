import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { explainReconcile } from "@/lib/ai/reconcile";

// Compare an account's recorded balance with the real bank balance the user types in, and use the
// AI to explain the difference over the last 7 days (duplicates to remove, or missing entries).
export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const accountId = String(body.account_id || "");
    const trueBalance = parseFloat(String(body.true_balance).replace(",", "."));
    const locale = body.locale === "fi" ? "fi" : "en";
    if (!accountId || !isFinite(trueBalance)) {
      return NextResponse.json({ error: "account_id and true_balance required" }, { status: 400 });
    }

    const db = getDb();
    const acct = db.prepare("SELECT name, balance FROM ynab_accounts WHERE id = ?").get(accountId) as { name: string; balance: number } | undefined;
    if (!acct) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const stored = Math.round(acct.balance * 100) / 100;
    const diff = Math.round((trueBalance - stored) * 100) / 100;

    // Recent transactions on this account (ynab_id is the stable id used by the delete endpoint).
    const recent = db.prepare(
      "SELECT ynab_id AS id, date, payee, amount FROM transactions WHERE account_id = ? AND date >= date('now', '-7 days') ORDER BY date DESC, id DESC LIMIT 60"
    ).all(accountId) as { id: string; date: string; payee: string; amount: number }[];

    if (Math.abs(diff) < 0.005) {
      return NextResponse.json({ stored, trueBalance, diff: 0, explanation: locale === "fi" ? "Saldo täsmää." : "The balance matches.", suspects: [] });
    }

    const ai = await explainReconcile(stored, trueBalance, diff, recent, locale);
    const byId = new Map(recent.map((t) => [t.id, t]));
    const suspects = ai.duplicateIds.filter((id) => byId.has(id)).map((id) => byId.get(id)!);

    console.info("[accounts/reconcile]", acct.name, "stored", stored, "true", trueBalance, "diff", diff, "suspects", suspects.length);
    return NextResponse.json({ stored, trueBalance, diff, explanation: ai.explanation, suspects });
  } catch (error) {
    console.error("[accounts/reconcile] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
