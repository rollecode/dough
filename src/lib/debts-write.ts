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

// Only the fields sent change; the rest keep what they were, so a client can change one figure
// without restating the others.
export function updateDebtOverride(p: DebtOverrideUpdate): { ok: true } | { error: string } {
  if (!p.ynab_account_id) return { error: "ynab_account_id required" };
  const db = getDb();

  if (p.due_day !== undefined && p.due_day !== 0 && (p.due_day < 1 || p.due_day > 31)) {
    return { error: "Due day must be 1-31" };
  }

  const prev = db.prepare("SELECT interest_rate, minimum_payment, due_day, notes, is_priority FROM debt_overrides WHERE ynab_account_id = ?")
    .get(p.ynab_account_id) as { interest_rate: number; minimum_payment: number; due_day: number; notes: string; is_priority: number } | undefined;
  db.prepare(
    "INSERT INTO debt_overrides (ynab_account_id, interest_rate, minimum_payment, due_day, notes, is_priority) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(ynab_account_id) DO UPDATE SET interest_rate = excluded.interest_rate, minimum_payment = excluded.minimum_payment, due_day = excluded.due_day, notes = excluded.notes, is_priority = excluded.is_priority, updated_at = datetime('now')"
  ).run(
    p.ynab_account_id,
    p.interest_rate ?? prev?.interest_rate ?? 0,
    p.minimum_payment ?? prev?.minimum_payment ?? 0,
    p.due_day ?? prev?.due_day ?? 0,
    p.notes ?? prev?.notes ?? "",
    p.is_priority === undefined ? (prev?.is_priority ?? 0) : (p.is_priority ? 1 : 0),
  );

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
