import { getDb } from "./db";
import {
  monthBudgetNumbers,
  assignedForMonth,
  makeTargetResolver,
  walkCategory,
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
  const cats = db.prepare("SELECT id, name, subscription_id, bill_id, debt_account_id, investment_account_id, savings_goal_id FROM categories WHERE is_active = 1 ORDER BY group_name, sort_order, name").all() as { id: number; name: string; subscription_id: number | null; bill_id: number | null; debt_account_id: string | null; investment_account_id: string | null; savings_goal_id: number | null }[];
  const prev = ym(month, -1);
  let rta = monthBudgetNumbers(db, month, assignedForMonth(db, month)).readyToAssign;

  // Per-mode "desired" amount each category should receive this month
  const desired = new Map<number, number>();
  if (mode === "underfunded") {
    // Resolve each category's effective target exactly like the budget row (manual targets AND
    // links to subscriptions/bills/debts/investments/savings goals), then top this month's
    // assignment up to that target. Matching the row's own underfunded test (budgeted < target)
    // means "fund to targets" fills precisely the yellow shortfalls the user sees and turns them
    // green, and never silently skips a link-derived target the way the old category_targets-only
    // pass did.
    const resolve = makeTargetResolver(db, month);
    const budgetedThis = new Map((db.prepare("SELECT category_id, budgeted FROM monthly_category_budgets WHERE month = ?").all(month) as { category_id: number; budgeted: number }[]).map((r) => [r.category_id, r.budgeted]));
    for (const c of cats) {
      const carry = walkCategory(db, c.id, c.name, month).carryInto;
      const t = resolve(c, carry);
      if (!t.target_active) continue;
      const budgeted = budgetedThis.get(c.id) || 0;
      const need = round(t.target_monthly - budgeted);
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
