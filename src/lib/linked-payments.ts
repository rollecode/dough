import { getDb } from "./db";
import { getBudgetMode, getHouseholdSetting } from "./household";

// A payment filed under a category linked to a debt or investment also moves that account, the way
// YNAB books a transfer to a tracking account: the debt goes down, the investment grows. Each payment
// gets one opposite leg on the linked account, keyed by the payment's own id so it can never double.
// A reconciliation or starting balance on the account is the truth up to its date, so no new leg is
// booked on or before it, nor before the household's linked_payments_since cutoff (imported history).

type Db = ReturnType<typeof getDb>;

const LEG_PREFIX = "link_";
const ADOPT_WINDOW_DAYS = 3;

export const isLinkedLeg = (id: string) => id.startsWith(LEG_PREFIX);

// Balance and, for an investment that tracks it, the money put in move together.
function moveBalance(db: Db, accountId: string, delta: number): void {
  db.prepare("UPDATE ynab_accounts SET balance = ROUND(balance + ?, 2), updated_at = datetime('now') WHERE id = ?").run(delta, accountId);
  db.prepare(
    "UPDATE investment_overrides SET contributed = ROUND(contributed + ?, 2), updated_at = datetime('now') " +
      "WHERE ynab_account_id = ? AND contributed IS NOT NULL AND ynab_account_id IN (SELECT id FROM ynab_accounts WHERE type = 'otherAsset')"
  ).run(delta, accountId);
}

function lastAnchorDate(db: Db, accountId: string): string {
  const row = db.prepare(
    "SELECT MAX(date) AS d FROM transactions WHERE account_id = ? AND (payee LIKE 'Reconciliation%' OR payee LIKE 'Manual Balance Adjustment%' OR payee LIKE 'Starting Balance%')"
  ).get(accountId) as { d: string | null };
  return row.d || "";
}

interface Source {
  date: string;
  amount: number;
  payee: string;
  account_id: string;
  account_name: string;
  linked: string | null;
}

// An edit to the payment itself decides its leg. A background scan only adds legs and drops those
// whose payment is gone: unlinking or deleting a category must not undo payments already booked.
export type LegSync = "edit" | "scan";

// Bring the leg of one payment in line with it: create, move, or remove it. Idempotent.
export function syncLinkedLeg(db: Db, userId: number, sourceId: string, how: LegSync = "edit"): void {
  if (isLinkedLeg(sourceId) || getBudgetMode() !== "local") return;
  const legId = `${LEG_PREFIX}${sourceId}`;
  const leg = db.prepare("SELECT amount, account_id, date FROM transactions WHERE ynab_id = ?").get(legId) as
    | { amount: number; account_id: string; date: string }
    | undefined;
  const src = db.prepare(
    "SELECT t.date, t.amount, t.payee, t.account_id, COALESCE(a.name, '') AS account_name, " +
      "(SELECT COALESCE(c.debt_account_id, c.investment_account_id) FROM categories c " +
      " WHERE c.name = t.category AND COALESCE(c.debt_account_id, c.investment_account_id) IS NOT NULL LIMIT 1) AS linked " +
      "FROM transactions t LEFT JOIN ynab_accounts a ON a.id = t.account_id WHERE t.ynab_id = ?"
  ).get(sourceId) as Source | undefined;

  const target = src?.linked && src.linked !== src.account_id && !(src.payee || "").startsWith("Transfer")
    && db.prepare("SELECT 1 FROM ynab_accounts WHERE id = ?").get(src.linked) ? src.linked : "";

  if (!src || !target) {
    if (!leg || (src && how === "scan")) return;
    db.prepare("DELETE FROM transactions WHERE ynab_id = ?").run(legId);
    moveBalance(db, leg.account_id, -leg.amount);
    console.info("[linked-payments] Removed leg of", sourceId);
    return;
  }

  const amount = -src.amount;
  const payee = `Transfer : ${src.account_name}`;
  if (leg) {
    if (leg.amount === amount && leg.account_id === target && leg.date === src.date) return;
    db.prepare("UPDATE transactions SET amount = ?, account_id = ?, date = ?, payee = ? WHERE ynab_id = ?").run(amount, target, src.date, payee, legId);
    moveBalance(db, leg.account_id, -leg.amount);
    moveBalance(db, target, amount);
    console.info("[linked-payments] Moved leg of", sourceId);
    return;
  }

  const since = getHouseholdSetting("linked_payments_since") || "";
  const anchor = lastAnchorDate(db, target);
  if (src.date < since || (anchor && src.date <= anchor)) {
    console.debug("[linked-payments] Payment", sourceId, "predates the account's anchor, no leg");
    return;
  }

  // The user may already have entered this payment on the debt by hand: adopt it instead of doubling.
  const manual = db.prepare(
    "SELECT ynab_id FROM transactions WHERE account_id = ? AND ROUND(amount, 2) = ROUND(?, 2) " +
      "AND ABS(julianday(date) - julianday(?)) <= ? AND ynab_id NOT LIKE 'link_%' " +
      "AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE '%Balance Adjustment%' AND payee NOT LIKE 'Starting Balance%' LIMIT 1"
  ).get(target, amount, src.date, ADOPT_WINDOW_DAYS) as { ynab_id: string } | undefined;
  if (manual) {
    db.prepare("UPDATE transactions SET ynab_id = ?, payee = ? WHERE ynab_id = ?").run(legId, payee, manual.ynab_id);
    console.info("[linked-payments] Adopted a hand-entered payment as the leg of", sourceId);
    return;
  }

  db.prepare(
    "INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared) VALUES (?, ?, ?, ?, ?, '', '', ?, 1, 'cleared')"
  ).run(userId, legId, src.date, amount, payee, target);
  moveBalance(db, target, amount);
  console.info("[linked-payments] Booked leg of", sourceId, "on", target);
}

// Every payment in a linked category plus every existing leg, so orphaned legs go too.
export function syncLinkedLegs(db: Db, userId: number): void {
  if (getBudgetMode() !== "local") return;
  const ids = db.prepare(
    "SELECT t.ynab_id AS id FROM transactions t WHERE t.ynab_id NOT LIKE 'link_%' AND t.category IN " +
      "(SELECT name FROM categories WHERE debt_account_id IS NOT NULL OR investment_account_id IS NOT NULL) " +
      "UNION SELECT SUBSTR(ynab_id, LENGTH('link_') + 1) FROM transactions WHERE ynab_id LIKE 'link_%'"
  ).all() as { id: string }[];
  const run = db.transaction(() => {
    for (const { id } of ids) syncLinkedLeg(db, userId, id, "scan");
  });
  run();
  console.debug("[linked-payments] Synced", ids.length, "linked payments");
}

export interface AccountEntry {
  id: string;
  date: string;
  amount: number;
  payee: string;
  memo: string;
}

// Everything booked on a debt or investment, newest first: payments, charges and adjustments.
export function accountEntries(db: Db, accountId: string): AccountEntry[] {
  return db.prepare(
    "SELECT ynab_id AS id, date, amount, payee, COALESCE(memo, '') AS memo FROM transactions WHERE account_id = ? ORDER BY date DESC, id DESC"
  ).all(accountId) as AccountEntry[];
}

// The budget category that pays into this account, if one is linked.
export function linkedCategoryName(db: Db, accountId: string): string | null {
  const row = db.prepare("SELECT name FROM categories WHERE debt_account_id = ? OR investment_account_id = ? LIMIT 1").get(accountId, accountId) as
    | { name: string }
    | undefined;
  return row?.name ?? null;
}
