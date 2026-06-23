import type { getDb } from "@/lib/db";

// Deterministic categorization for fixed-price recurring payments. If past transactions with the
// same payee AND the same amount were consistently filed under one category, reuse it - a stable
// amount is a strong signal (a subscription, a fixed monthly bill), and this needs no model call.
// Returns null when there is no prior match or the history is split across categories.
export function categoryByPayeeAmount(db: ReturnType<typeof getDb>, payee: string, amount: number): string | null {
  const p = (payee || "").trim();
  if (!p || !isFinite(amount) || amount === 0) return null;
  const amt = Math.round(Math.abs(amount) * 100) / 100;
  const rows = db.prepare(
    "SELECT category, COUNT(*) AS c FROM transactions " +
      "WHERE LOWER(payee) = LOWER(?) AND ROUND(ABS(amount), 2) = ? " +
      "AND COALESCE(category, '') <> '' AND category != 'Uncategorized' AND category NOT LIKE 'Inflow:%' " +
      "AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' AND payee NOT LIKE 'Reconciliation%' " +
      "GROUP BY category ORDER BY c DESC"
  ).all(p, amt) as { category: string; c: number }[];
  if (rows.length === 0) return null;
  // Only auto-pick when the top category is a clear majority, so a payee+amount that has been filed
  // inconsistently doesn't get a misleading guess.
  const total = rows.reduce((s, r) => s + r.c, 0);
  if (rows[0].c / total < 0.6) return null;
  return rows[0].category;
}
