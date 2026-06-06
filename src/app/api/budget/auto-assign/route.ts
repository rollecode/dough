import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";
import { availableForCategory, monthlyTargetEquivalent, monthBudgetNumbers, assignedForMonth } from "@/lib/budget-math";

function ym(monthYM: string, offset: number): string {
  const [y, m] = monthYM.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const round = (n: number) => Math.round(n * 100) / 100;

// YNAB-style Quick Budget / Auto-Assign. Modes:
//  underfunded     - fund each category with a target up to what it still needs this month,
//                    in order, stopping when Ready to Assign runs out
//  last_assigned   - copy the previous month's assigned amounts
//  last_spent      - assign each category what it actually spent last month
export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { month, mode } = await request.json();
    if (!/^\d{4}-\d{2}$/.test(String(month || ""))) {
      return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
    }
    if (!["underfunded", "last_assigned", "last_spent"].includes(String(mode))) {
      return NextResponse.json({ error: "mode must be underfunded, last_assigned or last_spent" }, { status: 400 });
    }

    const db = getDb();
    const cats = db.prepare("SELECT id, name FROM categories WHERE is_active = 1 ORDER BY group_name, sort_order, name").all() as { id: number; name: string }[];
    const upsert = db.prepare(
      "INSERT INTO monthly_category_budgets (month, category_id, budgeted) VALUES (?, ?, ?) " +
        "ON CONFLICT(month, category_id) DO UPDATE SET budgeted = excluded.budgeted, updated_at = datetime('now')"
    );
    const prev = ym(month, -1);
    let applied = 0;

    if (mode === "last_assigned") {
      const get = db.prepare("SELECT budgeted FROM monthly_category_budgets WHERE month = ? AND category_id = ?");
      const run = db.transaction(() => {
        for (const c of cats) {
          const b = (get.get(prev, c.id) as { budgeted: number } | undefined)?.budgeted || 0;
          if (b !== 0) { upsert.run(month, c.id, round(b)); applied++; }
        }
      });
      run();
    } else if (mode === "last_spent") {
      const start = `${prev}-01`;
      const [py, pm] = prev.split("-").map(Number);
      const end = `${prev}-${String(new Date(py, pm, 0).getDate()).padStart(2, "0")}`;
      const actRows = db
        .prepare(
          "SELECT category, ROUND(SUM(-amount), 2) AS v FROM transactions WHERE date >= ? AND date <= ? AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' AND payee NOT LIKE 'Reconciliation%' GROUP BY category"
        )
        .all(start, end) as { category: string; v: number }[];
      const actMap = new Map(actRows.map((r) => [r.category, r.v || 0]));
      const run = db.transaction(() => {
        for (const c of cats) {
          const a = round(actMap.get(c.name) || 0);
          if (a > 0) { upsert.run(month, c.id, a); applied++; }
        }
      });
      run();
    } else {
      // underfunded
      const targets = db
        .prepare("SELECT category_id, monthly_amount, COALESCE(cadence, 'monthly') AS cadence, snooze_until_month FROM category_targets")
        .all() as { category_id: number; monthly_amount: number; cadence: string; snooze_until_month: string }[];
      const tMap = new Map(targets.map((t) => [t.category_id, t]));
      const snoozed = new Set((db.prepare("SELECT category_id FROM category_snoozes WHERE month = ?").all(month) as { category_id: number }[]).map((r) => r.category_id));
      const getCur = db.prepare("SELECT budgeted FROM monthly_category_budgets WHERE month = ? AND category_id = ?");

      let rta = monthBudgetNumbers(db, month, assignedForMonth(db, month)).readyToAssign;
      const run = db.transaction(() => {
        for (const c of cats) {
          if (rta <= 0.005) break;
          const t = tMap.get(c.id);
          if (!t || t.monthly_amount <= 0) continue;
          if (snoozed.has(c.id)) continue;
          if (t.snooze_until_month && t.snooze_until_month >= month) continue;
          const targetMonthly = monthlyTargetEquivalent(t.monthly_amount, t.cadence, month);
          const avail = availableForCategory(db, c.id, c.name, month);
          let needed = round(targetMonthly - avail);
          if (needed <= 0.005) continue;
          needed = round(Math.min(needed, rta));
          if (needed <= 0) continue;
          const cur = (getCur.get(month, c.id) as { budgeted: number } | undefined)?.budgeted || 0;
          upsert.run(month, c.id, round(cur + needed));
          rta = round(rta - needed);
          applied++;
        }
      });
      run();
    }

    console.info("[budget/auto-assign]", month, "mode", mode, "applied to", applied, "categories");
    eventBus.emit("data:updated", { source: "budget-auto-assign" });
    return NextResponse.json({ success: true, applied });
  } catch (error) {
    console.error("[budget/auto-assign] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
