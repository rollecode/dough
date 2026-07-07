import { randomUUID } from "crypto";
import { getDb } from "./db";
import { getHouseholdSetting, setHouseholdSetting } from "./household";
import { eventBus } from "./event-bus";
import { localDateIso } from "./date-utils";
import { INTERNAL_TRANSFER_CATEGORY, normTransferPayee, isGenericTransferPayee } from "./transaction-utils";

// Local-mode transaction mutations shared by the internal session-authenticated route and the
// key-authenticated v1 API. A field left undefined keeps the stored value, so API callers can
// patch a single field; the edit dialog always sends every field, which preserves its behaviour.

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
}

export function updateLocalTransaction(
  userId: number,
  params: LocalTransactionUpdate
): { found: boolean } {
  const db = getDb();
  const prev = db
    .prepare("SELECT amount, account_id, category, payee, memo, date FROM transactions WHERE ynab_id = ?")
    .get(params.transaction_id) as
    | { amount: number; account_id: string; category: string; payee: string; memo: string | null; date: string }
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

  db.prepare("UPDATE transactions SET amount = ?, payee = ?, memo = ?, account_id = ?, date = ?, category = ? WHERE ynab_id = ?")
    .run(signed, newPayee, newMemo, newAccount, newDate, newCategory, params.transaction_id);
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

  // Internal transfer with a chosen counterpart account: make sure the other leg exists so the
  // transfer shows on both accounts. Reuse an existing opposite-amount leg on that account (e.g.
  // one Synci imported) rather than creating a duplicate.
  const transferAcct = params.transfer_account_id ? String(params.transfer_account_id) : "";
  if (transferAcct && transferAcct !== newAccount && newCategory === INTERNAL_TRANSFER_CATEGORY) {
    const counterSigned = -signed;
    const nameOf = (id: string) =>
      (db.prepare("SELECT name FROM ynab_accounts WHERE id = ?").get(id) as { name: string } | undefined)?.name || "";
    const thisName = nameOf(newAccount);
    const counterName = nameOf(transferAcct);
    const existing = db.prepare(
      "SELECT ynab_id FROM transactions WHERE account_id = ? AND ROUND(amount, 2) = ROUND(?, 2) AND category != 'Internal transfer' AND date BETWEEN date(?, '-2 days') AND date(?, '+2 days') LIMIT 1"
    ).get(transferAcct, counterSigned, newDate, newDate) as { ynab_id: string } | undefined;
    if (existing) {
      db.prepare("UPDATE transactions SET payee = ?, category = ? WHERE ynab_id = ?")
        .run(`Transfer : ${thisName}`, INTERNAL_TRANSFER_CATEGORY, existing.ynab_id);
    } else {
      db.prepare("INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared) VALUES (?, ?, ?, ?, ?, ?, '', ?, 1, 'cleared')")
        .run(userId, `local_${randomUUID()}`, newDate, counterSigned, `Transfer : ${thisName}`, INTERNAL_TRANSFER_CATEGORY, transferAcct);
      db.prepare("UPDATE ynab_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?").run(counterSigned, transferAcct);
    }
    db.prepare("UPDATE transactions SET payee = ? WHERE ynab_id = ?").run(`Transfer : ${counterName}`, params.transaction_id);
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
  const id = `local_${randomUUID()}`;

  db.prepare("INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)")
    .run(userId, id, date, signed, payee, category, memo, account, cleared);
  db.prepare("UPDATE ynab_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?").run(signed, account);

  // Internal transfer with a chosen counterpart account: make sure the other leg exists so the
  // transfer shows on both accounts. Reuse an existing opposite-amount leg rather than duplicating.
  const transferAcct = params.transfer_account_id ? String(params.transfer_account_id) : "";
  if (transferAcct && transferAcct !== account && category === INTERNAL_TRANSFER_CATEGORY) {
    const counterSigned = -signed;
    const nameOf = (aid: string) =>
      (db.prepare("SELECT name FROM ynab_accounts WHERE id = ?").get(aid) as { name: string } | undefined)?.name || "";
    const thisName = nameOf(account);
    const counterName = nameOf(transferAcct);
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
    db.prepare("UPDATE transactions SET payee = ? WHERE ynab_id = ?").run(`Transfer : ${counterName}`, id);
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
