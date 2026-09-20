import { getDb } from "./db";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface PayeeMatch {
  id: number;
  source_type: "income" | "bill" | "investment" | "subscription";
  source_id: number;
  payee_pattern: string;
  min_amount: number;
  max_amount: number;
}

interface MonthlyMatch {
  id: number;
  source_type: "income" | "bill" | "investment" | "subscription";
  source_id: number;
  month: string;
  ynab_transaction_id: string;
  amount: number;
}

export function getPayeePatterns(sourceType: "income" | "bill" | "investment" | "subscription", sourceId: number): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT payee_pattern FROM payee_matches WHERE source_type = ? AND source_id = ?")
    .all(sourceType, sourceId) as { payee_pattern: string }[];
  return rows.map((r) => r.payee_pattern);
}

export function addPayeePattern(sourceType: "income" | "bill" | "investment" | "subscription", sourceId: number, pattern: string): void {
  const db = getDb();
  db.prepare("INSERT INTO payee_matches (source_type, source_id, payee_pattern) VALUES (?, ?, ?)")
    .run(sourceType, sourceId, pattern);
  console.info("[matching] Added pattern:", pattern, "for", sourceType, sourceId);
}

export function removePayeePattern(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM payee_matches WHERE id = ?").run(id);
  console.info("[matching] Removed pattern ID:", id);
}

export function getAllPatterns(): PayeeMatch[] {
  const db = getDb();
  return db.prepare("SELECT * FROM payee_matches").all() as PayeeMatch[];
}

export function getMonthlyMatches(month: string): MonthlyMatch[] {
  const db = getDb();
  return db.prepare("SELECT * FROM monthly_matches WHERE month = ?").all(month) as MonthlyMatch[];
}

export function isMatchedThisMonth(sourceType: "income" | "bill" | "investment" | "subscription", sourceId: number, month: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM monthly_matches WHERE source_type = ? AND source_id = ? AND month = ? LIMIT 1")
    .get(sourceType, sourceId, month);
  return !!row;
}

function normalisePayee(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function patternToMatcher(pattern: string): (payee: string) => boolean {
  const trimmed = pattern.trim();

  // *wildcard* syntax: *Dude* matches anything containing "Dude"
  if (trimmed.startsWith("*") && trimmed.endsWith("*")) {
    const inner = trimmed.slice(1, -1).toLowerCase();
    return (payee) => payee.toLowerCase().includes(inner);
  }

  // *suffix syntax: *Oy matches anything ending with "Oy"
  if (trimmed.startsWith("*")) {
    const inner = trimmed.slice(1).toLowerCase();
    return (payee) => payee.toLowerCase().endsWith(inner);
  }

  // prefix* syntax: Dude* matches anything starting with "Dude"
  if (trimmed.endsWith("*")) {
    const inner = trimmed.slice(0, -1).toLowerCase();
    return (payee) => payee.toLowerCase().startsWith(inner);
  }

  // A picked payee, compared case and whitespace insensitively. Wildcards above stay supported for
  // patterns entered before the picker existed.
  const want = normalisePayee(trimmed);
  return (payee) => normalisePayee(payee) === want;
}

/* The configured due day is a guess; the day the money actually left is the fact. Rolling it to the
   real payment day stops a bill that is always paid on the 12th from reporting itself overdue from
   the 6th onwards, every month. */
function rollDueDay(sourceType: string, sourceId: number, txDate: string): void {
  if (sourceType !== "bill" && sourceType !== "subscription") return;

  const day = parseInt(txDate.split("-")[2], 10);
  if (!day || day < 1 || day > 31) return;

  const table = sourceType === "bill" ? "recurring_bills" : "subscriptions";
  const db = getDb();
  const row = db.prepare(`SELECT due_day FROM ${table} WHERE id = ?`).get(sourceId) as { due_day: number } | undefined;
  if (!row || row.due_day === day) return;

  db.prepare(`UPDATE ${table} SET due_day = ?, updated_at = datetime('now') WHERE id = ?`).run(day, sourceId);
  console.info("[matching] Rolled", sourceType, sourceId, "due day", row.due_day, "->", day);
}

export function runAutoMatch(transactions: any[], month: string): { matched: number; details: string[] } {
  const db = getDb();
  const patterns = getAllPatterns();
  let matched = 0;
  const details: string[] = [];

  for (const pattern of patterns) {
    const matcher = patternToMatcher(pattern.payee_pattern);
    const matchingTx = transactions.find((tx: any) => {
      // Only this month's transactions can settle this month's bill. This replaces a day window
      // that had no upper bound and did not wrap, so a bill due late in the month rejected any
      // payment made early and then reported itself overdue.
      if (!tx.date || !String(tx.date).startsWith(month)) return false;
      const payee = tx.payee || tx.payee_name || "";
      if (!matcher(payee)) return false;
      // Check amount range if set (min > 0 or max > 0). A half-cent tolerance keeps an exact-price
      // match (min == max, e.g. an 11.99 subscription) robust against float rounding.
      if (pattern.min_amount > 0 || pattern.max_amount > 0) {
        const absAmount = Math.abs(tx.amount);
        if (pattern.min_amount > 0 && absAmount < pattern.min_amount - 0.005) return false;
        if (pattern.max_amount > 0 && absAmount > pattern.max_amount + 0.005) return false;
      }
      return true;
    });

    if (matchingTx) {
      const txId = matchingTx.id || matchingTx.ynab_id || "";
      try {
        db.prepare(`
          INSERT OR IGNORE INTO monthly_matches (source_type, source_id, month, ynab_transaction_id, amount)
          VALUES (?, ?, ?, ?, ?)
        `).run(pattern.source_type, pattern.source_id, month, txId, Math.abs(matchingTx.amount));
        matched++;
        details.push(`${pattern.source_type}:${pattern.source_id} matched "${matchingTx.payee || matchingTx.payee_name}" (${txId})`);
        console.debug("[matching] Matched", pattern.source_type, pattern.source_id, "to", matchingTx.payee || matchingTx.payee_name);
        rollDueDay(pattern.source_type, pattern.source_id, String(matchingTx.date));
      } catch {
        // Already matched, skip
      }
    }
  }

  console.info("[matching] Auto-match complete:", matched, "new matches for", month);
  return { matched, details };
}
