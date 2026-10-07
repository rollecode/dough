import { getDb } from "./db";
import {
  monthBudgetNumbers,
  assignedForMonth,
  makeTargetResolver,
  walkCategory,
  walkTables,
  walkFromTables,
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

export const AUTO_ASSIGN_MODES = ["underfunded", "last_assigned", "last_spent", "smart"] as const;
export type AutoAssignMode = (typeof AUTO_ASSIGN_MODES)[number];

// Build the assignment plan for a mode, capped at Ready to Assign so it never overbudgets (unlike
// YNAB, which lets you go negative). Returns the per-category additions and the total assigned.
export function computeAutoAssign(
  db: ReturnType<typeof getDb>,
  month: string,
  mode: AutoAssignMode
): { total: number; plan: { id: number; name: string; add: number }[] } {
  const cats = db.prepare("SELECT id, name, subscription_id, bill_id, debt_account_id, investment_account_id, savings_goal_id FROM categories WHERE is_active = 1 ORDER BY group_name, sort_order, name").all() as Cat[];
  const prev = ym(month, -1);
  let rta = monthBudgetNumbers(db, month, assignedForMonth(db, month)).readyToAssign;

  // Per-mode "desired" amount each category should receive this month, in the order to fund it
  let desired = new Map<number, number>();
  let queue: { id: number; want: number }[] | null = null;
  if (mode === "underfunded") {
    desired = targetNeeds(db, month, cats);
  } else if (mode === "smart") {
    queue = smartQueue(db, month, cats);
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

  // Greedily fund in order, never exceeding Ready to Assign
  queue ??= cats.filter((c) => desired.has(c.id)).map((c) => ({ id: c.id, want: desired.get(c.id)! }));
  if (mode === "underfunded") {
    // Targets due by a day of the month go first, earliest day first, when money runs short.
    const dueDay = new Map((db.prepare("SELECT category_id, due_day FROM category_targets WHERE due_day IS NOT NULL").all() as { category_id: number; due_day: number }[]).map((r) => [r.category_id, r.due_day]));
    queue.sort((a, b) => (dueDay.get(a.id) ?? 99) - (dueDay.get(b.id) ?? 99));
  }
  const names = new Map(cats.map((c) => [c.id, c.name]));
  const plan: { id: number; name: string; add: number }[] = [];
  let total = 0;
  for (const q of queue) {
    if (rta <= 0.005) break;
    const add = round(Math.min(q.want, rta));
    if (add <= 0) continue;
    const prior = plan.find((p) => p.id === q.id);
    if (prior) prior.add = round(prior.add + add);
    else plan.push({ id: q.id, name: names.get(q.id) ?? "", add });
    rta = round(rta - add);
    total = round(total + add);
  }
  return { total, plan };
}

type Cat = { id: number; name: string; subscription_id: number | null; bill_id: number | null; debt_account_id: string | null; investment_account_id: string | null; savings_goal_id: number | null };

// What each targeted category still needs this month, resolved exactly like the budget row (manual
// targets and links), so funding it turns precisely the yellow rows green.
function targetNeeds(db: ReturnType<typeof getDb>, month: string, cats: Cat[]): Map<number, number> {
  const resolve = makeTargetResolver(db, month);
  const budgetedThis = new Map((db.prepare("SELECT category_id, budgeted FROM monthly_category_budgets WHERE month = ?").all(month) as { category_id: number; budgeted: number }[]).map((r) => [r.category_id, r.budgeted]));
  const needs = new Map<number, number>();
  for (const c of cats) {
    const carry = walkCategory(db, c.id, c.name, month).carryInto;
    const t = resolve(c, carry);
    if (!t.target_active) continue;
    const need = round(t.target_monthly - (budgetedThis.get(c.id) || 0));
    if (need > 0.005) needs.set(c.id, need);
  }
  return needs;
}

// Overspending covered first, then targets topped up. Within each pass the categories spent on
// most often in the last three months come first, so everyday needs such as food lead.
export function smartQueue(db: ReturnType<typeof getDb>, month: string, cats: Cat[]): { id: number; want: number }[] {
  const uses = new Map((db.prepare(
    "SELECT category, COUNT(*) AS n FROM transactions WHERE date >= ? AND date < ? AND amount < 0 AND " + CATEGORY_ACTIVITY_PREDICATE + " GROUP BY category"
  ).all(`${ym(month, -3)}-01`, `${ym(month, 1)}-01`) as { category: string; n: number }[]).map((r) => [r.category, r.n]));
  const byUse = (list: Cat[]) => [...list].sort((a, b) => (uses.get(b.name) ?? 0) - (uses.get(a.name) ?? 0));

  const tables = walkTables(db);
  const cover = new Map<number, number>();
  for (const c of cats) {
    if (c.name.startsWith("Inflow:")) continue;
    const available = walkFromTables(tables, c.id, c.name, month).availableAt;
    if (available < -0.005) cover.set(c.id, round(-available));
  }
  const needs = targetNeeds(db, month, cats);

  const queue: { id: number; want: number }[] = [];
  for (const c of byUse(cats.filter((c) => cover.has(c.id)))) queue.push({ id: c.id, want: cover.get(c.id)! });
  for (const c of byUse(cats.filter((c) => needs.has(c.id)))) {
    // Covering an overspend already counts towards the month's target.
    const want = round(needs.get(c.id)! - (cover.get(c.id) ?? 0));
    if (want > 0.005) queue.push({ id: c.id, want });
  }
  return queue;
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

// Over-assigned: more assigned than there is money. Taking it back only ever touches this month's
// assignments and never more than a category still holds, so nothing already spent is undone.
// Order: what sits beyond a target, then categories without a target, then targeted ones, each
// pass taking from whichever has the most room first.
export interface UnassignRow {
  id: number;
  name: string;
  budgeted: number;
  available: number;
  target: number;
  targetActive: boolean;
}

export function planUnassign(overage: number, rows: UnassignRow[]): { id: number; name: string; take: number }[] {
  let left = round(overage);
  const room = new Map(rows.map((r) => [r.id, round(Math.max(0, Math.min(r.budgeted, r.available)))]));
  const takes = new Map<number, { id: number; name: string; take: number }>();

  const take = (r: UnassignRow, wanted: number) => {
    const amount = round(Math.min(wanted, room.get(r.id) ?? 0, left));
    if (amount <= 0.005) return;
    room.set(r.id, round((room.get(r.id) ?? 0) - amount));
    const prior = takes.get(r.id);
    takes.set(r.id, { id: r.id, name: r.name, take: round((prior?.take ?? 0) + amount) });
    left = round(left - amount);
  };
  const mostRoom = (list: UnassignRow[]) => [...list].sort((a, b) => (room.get(b.id) ?? 0) - (room.get(a.id) ?? 0));

  const targeted = rows.filter((r) => r.targetActive);
  for (const r of mostRoom(targeted)) take(r, r.budgeted - r.target);
  for (const r of mostRoom(rows.filter((r) => !r.targetActive))) take(r, Infinity);
  for (const r of mostRoom(targeted)) take(r, Infinity);
  return [...takes.values()];
}

export function applyUnassign(db: ReturnType<typeof getDb>, month: string): { unassigned: number; plan: { id: number; name: string; take: number }[] } {
  const rta = monthBudgetNumbers(db, month, assignedForMonth(db, month)).readyToAssign;
  if (rta >= -0.005) return { unassigned: 0, plan: [] };

  const cats = db
    .prepare("SELECT id, name, subscription_id, bill_id, debt_account_id, investment_account_id, savings_goal_id FROM categories WHERE is_active = 1 AND COALESCE(budget_excluded, 0) = 0")
    .all() as { id: number; name: string; subscription_id: number | null; bill_id: number | null; debt_account_id: string | null; investment_account_id: string | null; savings_goal_id: number | null }[];
  const budgeted = new Map((db.prepare("SELECT category_id, budgeted FROM monthly_category_budgets WHERE month = ?").all(month) as { category_id: number; budgeted: number }[]).map((r) => [r.category_id, r.budgeted]));
  const tables = walkTables(db);
  const resolve = makeTargetResolver(db, month);
  const rows: UnassignRow[] = cats
    .filter((c) => (budgeted.get(c.id) ?? 0) > 0.005)
    .map((c) => {
      const walk = walkFromTables(tables, c.id, c.name, month);
      const target = resolve(c, walk.carryInto);
      return { id: c.id, name: c.name, budgeted: budgeted.get(c.id) ?? 0, available: walk.availableAt, target: target.target_monthly || 0, targetActive: !!target.target_active };
    });

  const plan = planUnassign(-rta, rows);
  const set = db.prepare("UPDATE monthly_category_budgets SET budgeted = ?, updated_at = datetime('now') WHERE month = ? AND category_id = ?");
  db.transaction(() => {
    for (const p of plan) set.run(round((budgeted.get(p.id) ?? 0) - p.take), month, p.id);
  })();
  const unassigned = round(plan.reduce((sum, p) => sum + p.take, 0));
  console.info("[auto-assign] Took back", unassigned, "from", plan.length, "categories to clear over-assigning in", month);
  return { unassigned, plan };
}
