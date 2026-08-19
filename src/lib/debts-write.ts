// Debt/loan write logic shared by the session-authed /api/debts route and the key-authed
// /api/v1/debts routes. Debts are ynab_accounts of type 'otherDebt'; their editable fields live in
// debt_overrides keyed by ynab_account_id.
import { getDb } from "./db";
import { eventBus } from "./event-bus";

export interface DebtOverrideUpdate {
  ynab_account_id: string;
  interest_rate?: number;
  minimum_payment?: number;
  due_day?: number;
  notes?: string;
  original_amount?: number;
  is_priority?: boolean;
}

// Mirrors the internal PUT: a priority-only toggle (is_priority set, no due_day) just flips the flag;
// otherwise the full override is upserted, and original_amount is only touched when explicitly given
// so saving other fields never wipes the starting balance.
export function updateDebtOverride(p: DebtOverrideUpdate): { ok: true } | { error: string } {
  if (!p.ynab_account_id) return { error: "ynab_account_id required" };
  const db = getDb();

  if (p.is_priority !== undefined && p.due_day === undefined) {
    db.prepare("UPDATE debt_overrides SET is_priority = ?, updated_at = datetime('now') WHERE ynab_account_id = ?")
      .run(p.is_priority ? 1 : 0, p.ynab_account_id);
    eventBus.emit("data:updated", { source: "debt-priority-changed" });
    return { ok: true };
  }

  if (p.due_day !== undefined && p.due_day !== 0 && (p.due_day < 1 || p.due_day > 31)) {
    return { error: "Due day must be 1-31" };
  }

  db.prepare(
    "INSERT INTO debt_overrides (ynab_account_id, interest_rate, minimum_payment, due_day, notes) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(ynab_account_id) DO UPDATE SET interest_rate = excluded.interest_rate, minimum_payment = excluded.minimum_payment, due_day = excluded.due_day, notes = excluded.notes, updated_at = datetime('now')"
  ).run(p.ynab_account_id, p.interest_rate ?? 0, p.minimum_payment ?? 0, p.due_day ?? 0, p.notes ?? "");

  if (p.original_amount !== undefined) {
    db.prepare("UPDATE debt_overrides SET original_amount = ?, updated_at = datetime('now') WHERE ynab_account_id = ?")
      .run(Math.abs(Number(p.original_amount) || 0), p.ynab_account_id);
  }

  console.info("[debts] Override saved for", p.ynab_account_id);
  eventBus.emit("data:updated", { source: "debt-updated" });
  return { ok: true };
}

export function reorderDebts(order: string[]): { ok: true } {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO debt_overrides (ynab_account_id, sort_order) VALUES (?, ?) " +
      "ON CONFLICT(ynab_account_id) DO UPDATE SET sort_order = excluded.sort_order, updated_at = datetime('now')"
  );
  const batch = db.transaction(() => {
    for (let i = 0; i < order.length; i++) stmt.run(order[i], i);
  });
  batch();
  console.info("[debts] Saved order for", order.length, "debts");
  eventBus.emit("data:updated", { source: "debt-reordered" });
  return { ok: true };
}
