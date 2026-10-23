import { getDb } from "./db";
import { INTERNAL_TRANSFER_CATEGORY, transferCounterpartName } from "./transaction-utils";

// Every internal transfer leg has at most one counterpart, recorded both ways in transfer_peer.
// Rows stored before the column existed have it empty and are matched by their payee label.

type Db = ReturnType<typeof getDb>;

const MATCH_WINDOW_DAYS = 2;
// Legs Dough created itself; a bank leg (synci_*) is never deleted, only unpaired.
const LOCAL_PREFIX = "local_";

interface Leg {
  ynab_id: string;
  amount: number;
  account_id: string;
  date: string;
  payee: string;
}

export interface LegQuery {
  primaryId: string;
  primaryAccount: string;
  primaryName: string;
  counterAccount: string;
  counterName: string;
  amount: number; // the counterpart leg's signed amount
  date: string;
}

export function pairLegs(db: Db, a: string, b: string): void {
  db.prepare("UPDATE transactions SET transfer_peer = '' WHERE transfer_peer IN (?, ?) AND ynab_id NOT IN (?, ?)").run(a, b, a, b);
  db.prepare("UPDATE transactions SET transfer_peer = ? WHERE ynab_id = ?").run(b, a);
  db.prepare("UPDATE transactions SET transfer_peer = ? WHERE ynab_id = ?").run(a, b);
  console.debug("[transfer-pairing] Paired", a, "with", b);
}

// The live counterpart of a leg, if any.
export function peerLeg(db: Db, id: string): Leg | undefined {
  return db.prepare(
    "SELECT p.ynab_id, p.amount, p.account_id, p.date, p.payee FROM transactions t " +
      "JOIN transactions p ON p.ynab_id = t.transfer_peer WHERE t.ynab_id = ? AND t.transfer_peer != ''"
  ).get(id) as Leg | undefined;
}

// Undo a leg's pairing. A leg Dough created only to mirror this one goes with its balance effect;
// a leg the bank delivered stays and is left unpaired for the user to place.
export function releasePeer(db: Db, id: string): void {
  const peer = peerLeg(db, id);
  db.prepare("UPDATE transactions SET transfer_peer = '' WHERE ynab_id = ?").run(id);
  if (!peer) {
    return;
  }

  if (peer.ynab_id.startsWith(LOCAL_PREFIX)) {
    db.prepare("DELETE FROM transactions WHERE ynab_id = ?").run(peer.ynab_id);
    db.prepare("UPDATE ynab_accounts SET balance = balance - ?, updated_at = datetime('now') WHERE id = ?").run(peer.amount, peer.account_id);
    console.info("[transfer-pairing] Removed mirror leg", peer.ynab_id, "of", id);
    return;
  }

  db.prepare("UPDATE transactions SET transfer_peer = '' WHERE ynab_id = ?").run(peer.ynab_id);
  console.warn("[transfer-pairing] Unpaired bank leg", peer.ynab_id, "from", id, "- it has no counterpart now");
}

// Clear the pairing of rows about to be deleted, so their counterparts do not point at nothing.
export function forgetPeers(db: Db, ids: string[]): void {
  for (const id of ids) {
    db.prepare("UPDATE transactions SET transfer_peer = '' WHERE transfer_peer = ?").run(id);
  }
}

const isFree = (db: Db, peer: string) =>
  !peer || !db.prepare("SELECT 1 FROM transactions WHERE ynab_id = ?").get(peer);

// An internal-transfer leg on the counterpart account that is not paired with anything else.
export function freeTransferLeg(db: Db, q: LegQuery): string | undefined {
  const candidates = db.prepare(
    "SELECT ynab_id, payee, COALESCE(transfer_peer, '') AS peer FROM transactions " +
      "WHERE account_id = ? AND ROUND(amount, 2) = ROUND(?, 2) AND category = ? AND ynab_id != ? " +
      "AND ABS(julianday(date) - julianday(?)) <= ? ORDER BY ABS(julianday(date) - julianday(?)), ynab_id"
  ).all(q.counterAccount, q.amount, INTERNAL_TRANSFER_CATEGORY, q.primaryId, q.date, MATCH_WINDOW_DAYS, q.date) as
    { ynab_id: string; payee: string; peer: string }[];

  const mine = candidates.find((c) => c.peer === q.primaryId);
  if (mine) {
    return mine.ynab_id;
  }

  // Unpaired rows from before the column: one labelled for another account belongs to that account.
  const unpaired = candidates.filter((c) => {
    if (!isFree(db, c.peer)) {
      return false;
    }
    const named = transferCounterpartName(c.payee);
    return !named || named === q.primaryName;
  });
  if (unpaired.length === 0) {
    return undefined;
  }

  // Other unpaired legs on this account labelled for the counterpart may already own those rows.
  const rivals = (db.prepare(
    "SELECT COALESCE(transfer_peer, '') AS peer FROM transactions " +
      "WHERE account_id = ? AND ROUND(amount, 2) = ROUND(?, 2) AND category = ? AND ynab_id != ? AND payee = ? " +
      "AND ABS(julianday(date) - julianday(?)) <= ?"
  ).all(q.primaryAccount, -q.amount, INTERNAL_TRANSFER_CATEGORY, q.primaryId, `Transfer : ${q.counterName}`, q.date, MATCH_WINDOW_DAYS) as
    { peer: string }[]).filter((r) => isFree(db, r.peer)).length;

  if (unpaired.length <= rivals) {
    console.debug("[transfer-pairing] All", unpaired.length, "unpaired legs are claimed by", rivals, "other legs");
    return undefined;
  }
  return unpaired[0].ynab_id;
}
