import { getDb } from "./db";
import { categorizePayee } from "./ai/categorize";
import { categoryByPayeeAmount } from "./categorize-history";

type Db = ReturnType<typeof getDb>;

// The categories most often used for a payee and/or description in the ledger. A payee match
// weighs more than a description match; ties break on recency.
export function suggestCategories(db: Db, payee: string, memo: string): string[] {
  if (!payee && !memo) return [];
  const rows = db
    .prepare(
      "SELECT category, " +
        "SUM((CASE WHEN payee = ? THEN 3 ELSE 0 END) + (CASE WHEN ? <> '' AND memo = ? THEN 1 ELSE 0 END)) AS score, " +
        "MAX(date) AS recent " +
        "FROM transactions " +
        "WHERE COALESCE(category, '') NOT IN ('', 'Internal transfer', 'Inflow: Ready to Assign', 'Uncategorized') " +
        "AND (payee = ? OR (? <> '' AND memo = ?)) " +
        "GROUP BY category HAVING score > 0 ORDER BY score DESC, recent DESC LIMIT 6"
    )
    .all(payee, memo, memo, payee, memo, memo) as { category: string }[];
  return rows.map((r) => r.category);
}

// The single best guess: a payee and amount always filed the same way wins, otherwise the AI
// guesses from the payee and description.
export async function guessCategory(db: Db, payee: string, memo: string, amount: number): Promise<{ category: string; source?: string }> {
  if (!payee.trim()) return { category: "" };
  if (isFinite(amount)) {
    const hist = categoryByPayeeAmount(db, payee, amount);
    if (hist) return { category: hist, source: "history" };
  }
  const names = (db.prepare("SELECT name FROM categories WHERE is_active = 1").all() as { name: string }[]).map((c) => c.name);
  if (names.length === 0) return { category: "" };
  const context = memo ? `${payee} (${memo})` : payee;
  return { category: (await categorizePayee(context, names)) || "" };
}
