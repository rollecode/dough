import { getDb } from "./db";
import { localDateIso } from "./date-utils";

// Investment writes, shared by the session-authed /api/investments route and the key-authed
// /api/v1/investments routes. Investments are ynab_accounts of type 'otherAsset' with a per-account
// investment_overrides row. Editing preserves the market re-value (balance) side effect and the
// once-a-day investment_progress snapshot exactly as the internal route does.

const round = (n: number) => Math.round(n * 100) / 100;

export interface InvestmentUpdate {
  ynab_account_id: string;
  monthly_contribution?: number | string;
  expected_return?: number | string;
  notes?: string;
  ticker?: string;
  value?: number | string; // new reconciled market value; updates the account balance when present
  added?: number | string; // money contributed now; grows the cost basis
  init_contributed?: number | string; // seed the cost basis directly (new investment)
}

export function updateInvestment(p: InvestmentUpdate): { ok: true } | { error: string } {
  const id = String(p.ynab_account_id || "");
  if (!id) return { error: "ynab_account_id required" };
  const db = getDb();
  const acct = db.prepare("SELECT balance FROM ynab_accounts WHERE id = ?").get(id) as { balance: number } | undefined;
  const prev = db.prepare("SELECT contributed FROM investment_overrides WHERE ynab_account_id = ?").get(id) as { contributed: number | null } | undefined;
  const oldBalance = acct?.balance ?? 0;

  const hasValue = p.value !== undefined && p.value !== null && p.value !== "";
  const newValue = hasValue ? (parseFloat(String(p.value)) || 0) : oldBalance;

  const added = parseFloat(String(p.added ?? 0)) || 0;
  let contributed: number;
  if (p.init_contributed !== undefined && p.init_contributed !== null && p.init_contributed !== "") {
    contributed = round(parseFloat(String(p.init_contributed)) || 0);
  } else {
    const baseline = prev?.contributed != null ? prev.contributed : oldBalance;
    contributed = round(baseline + added);
  }

  const apply = db.transaction(() => {
    if (hasValue) {
      db.prepare("UPDATE ynab_accounts SET balance = ?, updated_at = datetime('now') WHERE id = ?").run(newValue, id);
    }
    db.prepare(
      "INSERT INTO investment_overrides (ynab_account_id, monthly_contribution, expected_return, notes, ticker, contributed) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(ynab_account_id) DO UPDATE SET monthly_contribution = excluded.monthly_contribution, expected_return = excluded.expected_return, notes = excluded.notes, ticker = excluded.ticker, contributed = excluded.contributed, updated_at = datetime('now')"
    ).run(id, p.monthly_contribution ?? 0, p.expected_return ?? 7, p.notes ?? "", p.ticker ?? "", contributed);

    const totals = db.prepare(
      "SELECT COALESCE(SUM(a.balance), 0) AS value, COALESCE(SUM(COALESCE(o.contributed, a.balance)), 0) AS invested " +
        "FROM ynab_accounts a LEFT JOIN investment_overrides o ON o.ynab_account_id = a.id " +
        "WHERE a.type = 'otherAsset' AND a.closed = 0"
    ).get() as { value: number; invested: number };
    const today = localDateIso();
    db.prepare(
      "INSERT INTO investment_progress (date, total_value, total_contributed) VALUES (?, ?, ?) " +
        "ON CONFLICT(date) DO UPDATE SET total_value = excluded.total_value, total_contributed = excluded.total_contributed"
    ).run(today, round(totals.value), round(totals.invested));
  });
  apply();
  console.info("[investments] Saved", id, "value:", newValue, "added:", added, "contributed:", contributed);
  return { ok: true };
}

export function reorderInvestments(order: string[]): { ok: true } | { error: string } {
  if (!Array.isArray(order)) return { error: "order array required" };
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO investment_overrides (ynab_account_id, sort_order) VALUES (?, ?) " +
      "ON CONFLICT(ynab_account_id) DO UPDATE SET sort_order = excluded.sort_order, updated_at = datetime('now')"
  );
  const batch = db.transaction(() => {
    for (let i = 0; i < order.length; i++) stmt.run(order[i], i);
  });
  batch();
  console.info("[investments] Saved order for", order.length, "investments");
  return { ok: true };
}
