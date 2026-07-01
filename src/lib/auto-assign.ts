import { getDb } from "./db";
import {
  availableForCategory,
  monthlyTargetEquivalent,
  byDateMonthlyTarget,
  monthBudgetNumbers,
  assignedForMonth,
  CATEGORY_ACTIVITY_PREDICATE,
} from "./budget-math";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Auto-assign planning, shared by the internal budget/auto-assign route and the public v1 API so
// both compute the exact same plan. Every mode is capped at Ready to Assign, so it never overbudgets.

function ym(monthYM: string, offset: number): string {
  const [y, m] = monthYM.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const round = (n: number) => Math.round(n * 100) / 100;

export const AUTO_ASSIGN_MODES = ["underfunded", "last_assigned", "last_spent"] as const;
export type AutoAssignMode = (typeof AUTO_ASSIGN_MODES)[number];

// Build the assignment plan for a mode, capped at Ready to Assign so it never overbudgets (unlike
// YNAB, which lets you go negative). Returns the per-category additions and the total assigned.
export function computeAutoAssign(
  db: ReturnType<typeof getDb>,
  month: string,
  mode: AutoAssignMode
): { total: number; plan: { id: number; name: string; add: number }[] } {
  const cats = db.prepare("SELECT id, name FROM categories WHERE is_active = 1 ORDER BY group_name, sort_order, name").all() as { id: number; name: string }[];
  const prev = ym(month, -1);
  let rta = monthBudgetNumbers(db, month, assignedForMonth(db, month)).readyToAssign;

  // Per-mode "desired" amount each category should receive this month
  const desired = new Map<number, number>();
  if (mode === "underfunded") {
    const targets = db.prepare("SELECT category_id, monthly_amount, COALESCE(cadence,'monthly') AS cadence, COALESCE(target_date,'') AS target_date, snooze_until_month FROM category_targets").all() as { category_id: number; monthly_amount: number; cadence: string; target_date: string; snooze_until_month: string }[];
    const tMap = new Map(targets.map((t) => [t.category_id, t]));
    const snoozed = new Set((db.prepare("SELECT category_id FROM category_snoozes WHERE month = ?").all(month) as { category_id: number }[]).map((r) => r.category_id));
    for (const c of cats) {
      const t = tMap.get(c.id);
      if (!t || t.monthly_amount <= 0 || snoozed.has(c.id)) continue;
      if (t.snooze_until_month && t.snooze_until_month >= month) continue;
      const available = availableForCategory(db, c.id, c.name, month);
      // by_date: fund this month's share of what is still missing toward the goal. Other
      // cadences refill the category up to their per-month equivalent.
      const need = t.cadence === "by_date" && t.target_date
        ? byDateMonthlyTarget(t.monthly_amount, available, month, t.target_date)
        : round(monthlyTargetEquivalent(t.monthly_amount, t.cadence, month) - available);
      if (need > 0.005) desired.set(c.id, need);
    }
  } else {
    const start = `${prev}-01`;
    const [py, pm] = prev.split("-").map(Number);
    const end = `${prev}-${String(new Date(py, pm, 0).getDate()).padStart(2, "0")}`;
    const curBudget = db.prepare("SELECT category_id, budgeted FROM monthly_category_budgets WHERE month = ?").all(month) as { category_id: number; budgeted: number }[];
    const curMap = new Map(curBudget.map((r) => [r.category_id, r.budgeted]));
    if (mode === "last_assigned") {
      const last = db.prepare("SELECT category_id, budgeted FROM monthly_category_budgets WHERE month = ?").all(prev) as { category_id: number; budgeted: number }[];
      for (const r of last) {
        const add = round(r.budgeted - (curMap.get(r.category_id) || 0));
        if (add > 0.005) desired.set(r.category_id, add);
      }
    } else {
      // last_spent: assign each category what it spent last month, net of what's already assigned
      const spent = db.prepare(
        "SELECT category, ROUND(SUM(-amount), 2) AS v FROM transactions WHERE date >= ? AND date <= ? AND " + CATEGORY_ACTIVITY_PREDICATE + " GROUP BY category"
      ).all(start, end) as { category: string; v: number }[];
      const spentMap = new Map(spent.map((r) => [r.category, r.v || 0]));
      for (const c of cats) {
        const add = round((spentMap.get(c.name) || 0) - (curMap.get(c.id) || 0));
        if (add > 0.005) desired.set(c.id, add);
      }
    }
  }

  // Greedily fund in category order, never exceeding Ready to Assign
  const plan: { id: number; name: string; add: number }[] = [];
  let total = 0;
  for (const c of cats) {
    if (rta <= 0.005) break;
    const want = desired.get(c.id);
    if (!want) continue;
    const add = round(Math.min(want, rta));
    if (add <= 0) continue;
    plan.push({ id: c.id, name: c.name, add });
    rta = round(rta - add);
    total = round(total + add);
  }
  return { total, plan };
}

// Apply an auto-assign plan: add each plan item on top of what is already budgeted this month.
// Returns the total assigned and the number of categories touched.
export function applyAutoAssign(
  db: ReturnType<typeof getDb>,
  month: string,
  mode: AutoAssignMode
): { assigned: number; count: number; plan: { id: number; name: string; add: number }[] } {
  const { total, plan } = computeAutoAssign(db, month, mode);
  const cur = db.prepare("SELECT COALESCE(budgeted,0) AS v FROM monthly_category_budgets WHERE month = ? AND category_id = ?");
  const set = db.prepare(
    "INSERT INTO monthly_category_budgets (month, category_id, budgeted) VALUES (?, ?, ?) " +
      "ON CONFLICT(month, category_id) DO UPDATE SET budgeted = excluded.budgeted, updated_at = datetime('now')"
  );
  const run = db.transaction(() => {
    for (const p of plan) {
      const existing = (cur.get(month, p.id) as { v: number } | undefined)?.v || 0;
      set.run(month, p.id, round(existing + p.add));
    }
  });
  run();
  return { assigned: total, count: plan.length, plan };
}
