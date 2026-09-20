import { getDb } from "@/lib/db";
import { explainReconcile } from "@/lib/ai/reconcile";

// Comparing what Dough holds for an account with what the bank says, and asking the model to
// explain the gap from the week's transactions. Shared by the settings page and /api/v1 so both
// get the same answer.
export interface ReconcileResult {
  stored: number;
  trueBalance: number;
  diff: number;
  explanation: string;
  suspects: { id: string; date: string; payee: string; amount: number }[];
}

export async function reconcileAccount(
  account: { id: string; name: string; balance: number },
  trueBalance: number,
  locale: string
): Promise<ReconcileResult> {
  const stored = Math.round(account.balance * 100) / 100;
  const diff = Math.round((trueBalance - stored) * 100) / 100;

  // The week's rows, newest first. Same-day rows tie-break on insertion order, because the id here
  // is the source id rather than a monotonic key.
  const recent = getDb()
    .prepare(
      "SELECT ynab_id AS id, date, payee, amount FROM transactions WHERE account_id = ? AND " +
        "date >= date('now', '-7 days') ORDER BY date DESC, rowid DESC LIMIT 60"
    )
    .all(account.id) as { id: string; date: string; payee: string; amount: number }[];

  if (Math.abs(diff) < 0.005) {
    return {
      stored,
      trueBalance,
      diff: 0,
      explanation: locale === "fi" ? "Saldo täsmää." : "The balance matches.",
      suspects: [],
    };
  }

  const ai = await explainReconcile(stored, trueBalance, diff, recent, locale);
  const byId = new Map(recent.map((t) => [t.id, t]));
  const suspects = ai.duplicateIds.filter((id) => byId.has(id)).map((id) => byId.get(id)!);

  console.info("[reconcile]", account.name, "stored", stored, "true", trueBalance, "diff", diff, "suspects", suspects.length);
  return { stored, trueBalance, diff, explanation: ai.explanation, suspects };
}
