import { randomUUID } from "crypto";
import { getDb } from "./db";
import { eventBus } from "./event-bus";
import { localDateIso } from "./date-utils";

// Shared account write logic, used by the session-authed /api/accounts route and the key-authed
// /api/v1/accounts routes so both create/edit/delete accounts identically. A manual account's
// balance seeds both balance and cleared_balance; editing the balance records a reconciliation
// transaction so history matches, and a manual account is hard-deleted while a synced one is closed.

export interface AccountCreate {
  name: string;
  type?: string;
  balance?: number | string;
  on_budget?: boolean;
}

export function createAccount(userId: number, p: AccountCreate): { id: string } | { error: string } {
  const name = String(p.name || "").trim();
  if (!name) return { error: "name required" };
  const type = String(p.type || "checking").trim();
  const balance = isFinite(Number(p.balance)) ? Math.round(Number(p.balance) * 100) / 100 : 0;
  const onBudget = p.on_budget === false ? 0 : 1;
  const id = `local_${randomUUID()}`;
  const db = getDb();
  const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM ynab_accounts").get() as { m: number }).m;
  db.prepare(
    "INSERT INTO ynab_accounts (id, name, type, balance, cleared_balance, on_budget, closed, source, sort_order, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, 0, 'manual', ?, datetime('now'))"
  ).run(id, name, type, balance, balance, onBudget, maxOrder + 1);
  // Dates the opening balance, so payments made before the account existed are never booked on it.
  if (balance !== 0) {
    db.prepare(
      "INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared) " +
        "VALUES (?, ?, ?, ?, 'Starting Balance', '', '', ?, 1, 'reconciled')"
    ).run(userId, `start_${randomUUID()}`, localDateIso(), balance, id);
  }
  console.info("[accounts] Created manual account", name, id);
  eventBus.emit("data:updated", { source: "accounts-added" });
  return { id };
}

export interface AccountUpdate {
  id: string;
  name?: string;
  type?: string;
  balance?: number | string;
  on_budget?: boolean;
  closed?: boolean;
  sort_order?: number | string;
}

export function updateAccount(userId: number, p: AccountUpdate): { found: boolean } {
  if (!p.id) return { found: false };
  const db = getDb();
  const exists = db.prepare("SELECT balance FROM ynab_accounts WHERE id = ?").get(p.id) as { balance: number } | undefined;
  if (!exists) return { found: false };

  const updates: string[] = [];
  const values: (string | number)[] = [];
  if (p.name !== undefined) { updates.push("name = ?"); values.push(String(p.name).trim()); }
  if (p.type !== undefined) { updates.push("type = ?"); values.push(String(p.type).trim()); }
  if (p.on_budget !== undefined) { updates.push("on_budget = ?"); values.push(p.on_budget ? 1 : 0); }
  if (p.closed !== undefined) { updates.push("closed = ?"); values.push(p.closed ? 1 : 0); }
  if (p.sort_order !== undefined) { updates.push("sort_order = ?"); values.push(parseInt(String(p.sort_order), 10) || 0); }
  if (updates.length === 0 && p.balance === undefined) return { found: true };
  if (p.balance !== undefined) reconcileBalance(userId, String(p.id), Number(p.balance));
  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(String(p.id));
    db.prepare(`UPDATE ynab_accounts SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }
  console.info("[accounts] Updated account", p.id);
  eventBus.emit("data:updated", { source: "accounts-updated" });
  return { found: true };
}

// Set an account to the balance the user sees at the bank or lender, booking the difference as a
// dated adjustment so history adds up. Payee starts with "Reconciliation" so it stays out of
// spending and income, and payments dated before it are not booked on the account again.
export function reconcileBalance(userId: number, accountId: string, balance: number): number {
  const db = getDb();
  const bal = Math.round(balance * 100) / 100;
  const prev = db.prepare("SELECT balance FROM ynab_accounts WHERE id = ?").get(accountId) as { balance: number } | undefined;
  if (!prev || !isFinite(bal)) return 0;
  const diff = Math.round((bal - prev.balance) * 100) / 100;
  db.prepare("UPDATE ynab_accounts SET balance = ?, cleared_balance = ?, updated_at = datetime('now') WHERE id = ?").run(bal, bal, accountId);
  if (Math.abs(diff) > 0.005) {
    db.prepare(
      "INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'reconciled')"
    ).run(userId, `recon_${randomUUID()}`, localDateIso(), diff, "Reconciliation Balance Adjustment", "", "", accountId);
    console.info("[accounts] Reconciliation adjustment", diff, "for account", accountId);
  }
  return diff;
}

// Manual accounts are hard-deleted; synced accounts are soft-closed (closed=1).
export function deleteAccount(id: string): { found: boolean; closed?: boolean } {
  if (!id) return { found: false };
  const db = getDb();
  const acct = db.prepare("SELECT source FROM ynab_accounts WHERE id = ?").get(id) as { source: string } | undefined;
  if (!acct) return { found: false };
  let closed = false;
  if (acct.source === "manual") {
    db.prepare("DELETE FROM ynab_accounts WHERE id = ?").run(id);
    console.info("[accounts] Deleted manual account", id);
  } else {
    db.prepare("UPDATE ynab_accounts SET closed = 1, updated_at = datetime('now') WHERE id = ?").run(id);
    closed = true;
    console.info("[accounts] Closed account", id);
  }
  eventBus.emit("data:updated", { source: "accounts-deleted" });
  return { found: true, closed };
}

export function reorderAccounts(order: string[]): { ok: true } {
  const db = getDb();
  const stmt = db.prepare("UPDATE ynab_accounts SET sort_order = ?, updated_at = datetime('now') WHERE id = ?");
  const batch = db.transaction(() => {
    for (let i = 0; i < order.length; i++) stmt.run(i, order[i]);
  });
  batch();
  console.info("[accounts] Saved order for", order.length, "accounts");
  eventBus.emit("data:updated", { source: "account-reordered" });
  return { ok: true };
}
