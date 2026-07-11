import { randomUUID } from "crypto";
import { getDb } from "./db";
import { getHouseholdSetting, setHouseholdSetting } from "./household";
import { eventBus } from "./event-bus";
import { localDateIso } from "./date-utils";
import { INTERNAL_TRANSFER_CATEGORY, normTransferPayee, isGenericTransferPayee } from "./transaction-utils";

// Local-mode transaction mutations shared by the internal session-authenticated route and the
// key-authenticated v1 API. A field left undefined keeps the stored value, so API callers can
// patch a single field; the edit dialog always sends every field, which preserves its behaviour.

// Ensure an internal transfer's opposite leg exists on the counterpart account exactly once, and
// that both legs name each other ("Transfer : <account>"). Idempotent: preference order is
//   1. an existing opposite internal-transfer leg (already paired, e.g. by Synci or a prior save):
//      reuse it, never duplicate. This is what makes re-saving a complete transfer safe now that
//      the edit dialog pre-fills and re-sends the counterpart account;
//   2. an unclassified opposite-amount leg to adopt (the other side arrived uncategorised);
//   3. otherwise fabricate the leg and apply its balance effect.
// Shared by updateLocalTransaction and createLocalTransaction so both maintain the pair identically.
function reconcileCounterpartLeg(
  db: ReturnType<typeof getDb>,
  userId: number,
  primaryId: string,
  primaryAccount: string,
  transferAcct: string,
  signed: number,
  date: string
): void {
  const counterSigned = -signed;
  const nameOf = (id: string) =>
    (db.prepare("SELECT name FROM ynab_accounts WHERE id = ?").get(id) as { name: string } | undefined)?.name || "";
  const thisName = nameOf(primaryAccount);
  const counterName = nameOf(transferAcct);
  const pairedLeg = db.prepare(
    "SELECT ynab_id FROM transactions WHERE account_id = ? AND ROUND(amount, 2) = ROUND(?, 2) AND category = 'Internal transfer' AND ynab_id != ? AND date BETWEEN date(?, '-2 days') AND date(?, '+2 days') LIMIT 1"
  ).get(transferAcct, counterSigned, primaryId, date, date) as { ynab_id: string } | undefined;
  if (pairedLeg) {
    // Transfer is already complete: just make sure the existing counterpart leg names this account.
    db.prepare("UPDATE transactions SET payee = ? WHERE ynab_id = ?").run(`Transfer : ${thisName}`, pairedLeg.ynab_id);
  } else {
    const existing = db.prepare(
      "SELECT ynab_id FROM transactions WHERE account_id = ? AND ROUND(amount, 2) = ROUND(?, 2) AND category != 'Internal transfer' AND date BETWEEN date(?, '-2 days') AND date(?, '+2 days') LIMIT 1"
    ).get(transferAcct, counterSigned, date, date) as { ynab_id: string } | undefined;
    if (existing) {
      db.prepare("UPDATE transactions SET payee = ?, category = ? WHERE ynab_id = ?")
        .run(`Transfer : ${thisName}`, INTERNAL_TRANSFER_CATEGORY, existing.ynab_id);
    } else {
      db.prepare("INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared) VALUES (?, ?, ?, ?, ?, ?, '', ?, 1, 'cleared')")
        .run(userId, `local_${randomUUID()}`, date, counterSigned, `Transfer : ${thisName}`, INTERNAL_TRANSFER_CATEGORY, transferAcct);
      db.prepare("UPDATE ynab_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?").run(counterSigned, transferAcct);
    }
  }
  db.prepare("UPDATE transactions SET payee = ? WHERE ynab_id = ?").run(`Transfer : ${counterName}`, primaryId);
}

export interface LocalTransactionUpdate {
  transaction_id: string;
  amount?: number | string; // absolute value; sign comes from inflow
  inflow?: boolean; // stored positive when true, negative otherwise
  payee_name?: string;
  memo?: string;
  account_id?: string;
  date?: string;
  category?: string;
  transfer_account_id?: string;
  budget_excluded?: boolean; // exclude from all budget figures (balance still changes)
}

export function updateLocalTransaction(
  userId: number,
  params: LocalTransactionUpdate
): { found: boolean } {
  const db = getDb();
  const prev = db
    .prepare("SELECT amount, account_id, category, payee, memo, date, COALESCE(budget_excluded, 0) AS budget_excluded FROM transactions WHERE ynab_id = ?")
    .get(params.transaction_id) as
    | { amount: number; account_id: string; category: string; payee: string; memo: string | null; date: string; budget_excluded: number }
    | undefined;
  if (!prev) {
    console.warn("[local-transactions] Update target not found:", params.transaction_id);
    return { found: false };
  }

  // Sign resolution: with an explicit amount the inflow flag decides the sign (defaulting to the
  // previous sign); without one the stored signed amount stays as is.
  const inflow = params.inflow ?? prev.amount >= 0;
  const signed =
    params.amount !== undefined
      ? (inflow ? 1 : -1) * Math.abs(parseFloat(String(params.amount)))
      : prev.amount;
  const newCategory = params.category !== undefined ? params.category : prev.category ?? "";
  const newAccount = params.account_id || prev.account_id;
  const newPayee = params.payee_name !== undefined ? params.payee_name : prev.payee;
  const newMemo = params.memo !== undefined ? params.memo : prev.memo || "";
  const newDate = params.date || prev.date;
  const newExcluded = params.budget_excluded !== undefined ? (params.budget_excluded ? 1 : 0) : prev.budget_excluded;

  db.prepare("UPDATE transactions SET amount = ?, payee = ?, memo = ?, account_id = ?, date = ?, category = ?, budget_excluded = ? WHERE ynab_id = ?")
    .run(signed, newPayee, newMemo, newAccount, newDate, newCategory, newExcluded, params.transaction_id);
  // Remove the old amount from the old account, add the new one to the new account
  db.prepare("UPDATE ynab_accounts SET balance = balance - ? WHERE id = ?").run(prev.amount, prev.account_id);
  db.prepare("UPDATE ynab_accounts SET balance = balance + ? WHERE id = ?").run(signed, newAccount);

  // Learn this payee as an internal-transfer payee so future Synci imports with the same payee
  // are recognized as transfers, not income. Skip the generic transfer descriptors.
  if (newCategory === INTERNAL_TRANSFER_CATEGORY) {
    const realPayee = (newPayee || "").trim();
    if (realPayee && !isGenericTransferPayee(realPayee)) {
      try {
        const rawList = getHouseholdSetting("internal_transfer_payees");
        const list: string[] = rawList ? JSON.parse(rawList) : [];
        if (!list.some((p) => p.toLowerCase() === realPayee.toLowerCase())) {
          list.push(realPayee);
          setHouseholdSetting("internal_transfer_payees", JSON.stringify(list));
          console.info("[local-transactions] Learned an internal-transfer payee");
        }
      } catch (e) {
        console.warn("[local-transactions] Failed to record internal-transfer payee:", e);
      }
      // Also learn which counterpart account this payee transfers with, so a future Synci import
      // that only delivers one leg can fill in the counterpart automatically.
      const learnedAcct = params.transfer_account_id ? String(params.transfer_account_id) : "";
      if (learnedAcct && learnedAcct !== newAccount) {
        try {
          const rawMap = getHouseholdSetting("transfer_payee_accounts");
          const map: Record<string, string> = rawMap ? JSON.parse(rawMap) : {};
          const key = normTransferPayee(realPayee);
          if (key && map[key] !== learnedAcct) {
            map[key] = learnedAcct;
            setHouseholdSetting("transfer_payee_accounts", JSON.stringify(map));
            console.info("[local-transactions] Learned a transfer counterpart account for a payee");
          }
        } catch (e) {
          console.warn("[local-transactions] Failed to record transfer counterpart account:", e);
        }
      }
    }
  }

  // Internal transfer with a chosen counterpart account: make sure the other leg exists exactly once
  // so the transfer shows on both accounts (idempotent, never duplicates a paired transfer).
  const transferAcct = params.transfer_account_id ? String(params.transfer_account_id) : "";
  if (transferAcct && transferAcct !== newAccount && newCategory === INTERNAL_TRANSFER_CATEGORY) {
    reconcileCounterpartLeg(db, userId, params.transaction_id, newAccount, transferAcct, signed, newDate);
  }

  eventBus.emit("data:updated", { source: "transaction-updated", userId });
  console.info("[local-transactions] Local transaction updated:", params.transaction_id);
  return { found: true };
}

export interface LocalTransactionCreate {
  account_id: string;
  amount: number | string; // absolute value; sign comes from inflow
  inflow?: boolean; // stored positive when true, negative otherwise (default false = money out)
  date?: string; // YYYY-MM-DD; defaults to today (Helsinki)
  payee_name?: string;
  memo?: string;
  category?: string;
  cleared?: string; // free-text ledger state; defaults to 'cleared'. Use 'uncleared' for pending holds.
  transfer_account_id?: string;
  budget_excluded?: boolean; // exclude from all budget figures (balance still changes)
}

// Insert a new transaction into Dough's local ledger and apply its balance effect. Mirrors the
// insert/balance mechanics of updateLocalTransaction. Used by the key-authenticated v1 API to add
// rows Synci has not imported yet - most importantly pending card holds (varaukset), so Dough can
// match the bank's available balance to the cent. Returns the new id, or an error if the account is
// unknown. Local mode only (enforced by the route).
export function createLocalTransaction(
  userId: number,
  params: LocalTransactionCreate
): { id: string } | { error: string } {
  const db = getDb();
  const account = String(params.account_id || "");
  const acct = db.prepare("SELECT id FROM ynab_accounts WHERE id = ?").get(account) as { id: string } | undefined;
  if (!acct) return { error: `No account with id ${account}` };

  const inflow = params.inflow ?? false;
  const signed = (inflow ? 1 : -1) * Math.abs(parseFloat(String(params.amount)));
  if (!isFinite(signed)) return { error: "amount must be a number" };
  const date = params.date || localDateIso();
  const payee = params.payee_name ?? "";
  const memo = params.memo ?? "";
  const category = params.category ?? "";
  const cleared = params.cleared || "cleared";
  const excluded = params.budget_excluded ? 1 : 0;
  const id = `local_${randomUUID()}`;

  db.prepare("INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared, budget_excluded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
    .run(userId, id, date, signed, payee, category, memo, account, cleared, excluded);
  db.prepare("UPDATE ynab_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?").run(signed, account);

  // Internal transfer with a chosen counterpart account: make sure the other leg exists exactly once
  // so the transfer shows on both accounts (idempotent, reuses a leg the bank already delivered).
  const transferAcct = params.transfer_account_id ? String(params.transfer_account_id) : "";
  if (transferAcct && transferAcct !== account && category === INTERNAL_TRANSFER_CATEGORY) {
    reconcileCounterpartLeg(db, userId, id, account, transferAcct, signed, date);
  }

  eventBus.emit("data:updated", { source: "transaction-created", userId });
  console.info("[local-transactions] Local transaction created:", id);
  return { id };
}

// Delete a local transaction (and any split siblings sharing its group), reversing the balance
// effect of every removed row.
export function deleteLocalTransaction(userId: number, transactionId: string): { found: boolean } {
  const db = getDb();
  const row = db.prepare("SELECT split_group FROM transactions WHERE ynab_id = ?").get(transactionId) as
    | { split_group: string }
    | undefined;
  if (!row) {
    console.warn("[local-transactions] Delete target not found:", transactionId);
    return { found: false };
  }
  const group = row.split_group || "";
  if (group) {
    const rows = db.prepare("SELECT amount, account_id FROM transactions WHERE split_group = ?").all(group) as { amount: number; account_id: string }[];
    for (const r of rows) db.prepare("UPDATE ynab_accounts SET balance = balance - ? WHERE id = ?").run(r.amount, r.account_id);
    db.prepare("DELETE FROM transactions WHERE split_group = ?").run(group);
  } else {
    const prev = db.prepare("SELECT amount, account_id FROM transactions WHERE ynab_id = ?").get(transactionId) as { amount: number; account_id: string } | undefined;
    db.prepare("DELETE FROM transactions WHERE ynab_id = ?").run(transactionId);
    if (prev) db.prepare("UPDATE ynab_accounts SET balance = balance - ? WHERE id = ?").run(prev.amount, prev.account_id);
  }
  eventBus.emit("data:updated", { source: "transaction-deleted", userId });
  console.info("[local-transactions] Local transaction deleted:", transactionId, group ? "(split group)" : "");
  return { found: true };
}
