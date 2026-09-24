import { getDb } from "./db";
import { eventBus } from "./event-bus";
import { getBudgetMode } from "./household";

// Payees a person typed, as opposed to the ones the ledger writes for itself.
export const NOT_MACHINE_PAYEE =
  "COALESCE(payee, '') <> '' AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' " +
  "AND payee NOT LIKE 'Reconciliation%'";

export interface PayeeUsage {
  payee: string;
  uses: number;
  last_used: string;
}

export function payeeUsage(limit: number): PayeeUsage[] {
  return getDb()
    .prepare(
      `SELECT payee, COUNT(*) AS uses, MAX(date) AS last_used FROM transactions ` +
        `WHERE ${NOT_MACHINE_PAYEE} GROUP BY payee ORDER BY uses DESC, last_used DESC LIMIT ?`
    )
    .all(limit) as PayeeUsage[];
}

// Every transaction under one of `from` takes the name `into`. Renaming a payee is merging it
// into a new name. Returns how many transactions changed.
export function mergePayees(from: string[], into: string): number {
  const target = into.trim();
  const sources = [...new Set(from.map((name) => name.trim()))].filter((name) => name && name !== target);
  if (!target || sources.length === 0) return 0;

  const db = getDb();
  const rename = db.prepare("UPDATE transactions SET payee = ? WHERE payee = ?");
  const changed = db.transaction(() => sources.reduce((sum, name) => sum + rename.run(target, name).changes, 0))();

  console.info("[payees] Merged", sources.length, "payees into", target, "across", changed, "transactions");
  eventBus.emit("data:updated", { source: "payees-merged" });
  return changed;
}

// A merge as the routes receive it: { from: [names], into: name }. Local mode only, like every
// other transaction write: in YNAB mode the payees belong to YNAB.
export function mergeRequest(body: unknown): { error: string } | { updated: number } {
  if (getBudgetMode() !== "local") return { error: "Payee changes are only available in local mode" };
  const { from, into } = (body ?? {}) as { from?: unknown; into?: unknown };
  if (!Array.isArray(from) || !from.every((name) => typeof name === "string")) {
    return { error: "from must be a list of payee names" };
  }
  if (typeof into !== "string" || !into.trim()) return { error: "into must be a payee name" };
  return { updated: mergePayees(from, into) };
}

// How many payees the model is shown at once, most used first: the payees API's own default page,
// which keeps the prompt to a size a quick model answers in seconds.
export const SUGGESTION_POOL = 300;
