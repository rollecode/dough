import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";
import { availableForCategory, monthlyTargetEquivalent, monthBudgetNumbers, assignedForMonth, CATEGORY_ACTIVITY_PREDICATE } from "@/lib/budget-math";

/* eslint-disable @typescript-eslint/no-explicit-any */

function ym(monthYM: string, offset: number): string {
  const [y, m] = monthYM.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const round = (n: number) => Math.round(n * 100) / 100;
const MODES = ["underfunded", "last_assigned", "last_spent"] as const;
type Mode = (typeof MODES)[number];

// Build the assignment plan for a mode, capped at Ready to Assign so it never overbudgets (unlike
// YNAB, which lets you go negative). Returns the per-category additions and the total assigned.
function computeAutoAssign(db: ReturnType<typeof getDb>, month: string, mode: Mode): { total: number; plan: { id: number; add: number }[] } {
  const cats = db.prepare("SELECT id, name FROM categories WHERE is_active = 1 ORDER BY group_name, sort_order, name").all() as { id: number; name: string }[];
  const prev = ym(month, -1);
  let rta = monthBudgetNumbers(db, month, assignedForMonth(db, month)).readyToAssign;

  // Per-mode "desired" amount each category should receive this month
  const desired = new Map<number, number>();
  if (mode === "underfunded") {
    const targets = db.prepare("SELECT category_id, monthly_amount, COALESCE(cadence,'monthly') AS cadence, snooze_until_month FROM category_targets").all() as { category_id: number; monthly_amount: number; cadence: string; snooze_until_month: string }[];
    const tMap = new Map(targets.map((t) => [t.category_id, t]));
    const snoozed = new Set((db.prepare("SELECT category_id FROM category_snoozes WHERE month = ?").all(month) as { category_id: number }[]).map((r) => r.category_id));
    for (const c of cats) {
      const t = tMap.get(c.id);
      if (!t || t.monthly_amount <= 0 || snoozed.has(c.id)) continue;
      if (t.snooze_until_month && t.snooze_until_month >= month) continue;
      const need = round(monthlyTargetEquivalent(t.monthly_amount, t.cadence, month) - availableForCategory(db, c.id, c.name, month));
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
  const plan: { id: number; add: number }[] = [];
  let total = 0;
  for (const c of cats) {
    if (rta <= 0.005) break;
    const want = desired.get(c.id);
    if (!want) continue;
    const add = round(Math.min(want, rta));
    if (add <= 0) continue;
    plan.push({ id: c.id, add });
    rta = round(rta - add);
    total = round(total + add);
  }
  return { total, plan };
}

// Preview: the amount each mode would assign (already capped at Ready to Assign)
export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const url = new URL(request.url);
    const now = new Date();
    const month = url.searchParams.get("month") || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const db = getDb();
    const out: Record<string, number> = {};
    for (const m of MODES) out[m] = computeAutoAssign(db, month, m).total;
    return NextResponse.json(out);
  } catch (error) {
    console.error("[budget/auto-assign] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { month, mode } = await request.json();
    if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
    if (!MODES.includes(mode)) return NextResponse.json({ error: "invalid mode" }, { status: 400 });

    const db = getDb();
    const { total, plan } = computeAutoAssign(db, month, mode as Mode);
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

    console.info("[budget/auto-assign]", month, "mode", mode, "assigned", total, "across", plan.length, "categories");
    eventBus.emit("data:updated", { source: "budget-auto-assign" });
    return NextResponse.json({ success: true, assigned: total, count: plan.length });
  } catch (error) {
    console.error("[budget/auto-assign] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
