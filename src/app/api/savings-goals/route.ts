import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { availableForCategory } from "@/lib/budget-math";
import { createSavingsGoal, updateSavingsGoal, deleteSavingsGoal } from "@/lib/savings-goals-write";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ goals: [] }, { status: 401 });

    const db = getDb();
    const goals = db
      .prepare("SELECT * FROM savings_goals ORDER BY created_at ASC")
      .all() as { id: number; saved_amount: number }[];

    // A goal linked to a budget category derives its saved progress from what is CURRENTLY set aside
    // in that category - its available balance (everything assigned minus everything spent, carried
    // forward) - not the lifetime sum of assignments. Summing budgeted made a category that is funded
    // and spent every month (e.g. a recurring cost) inflate "saved" far beyond what is actually saved.
    // Read-time derivation only - it never writes, so balances and stored data stay untouched.
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const linkRows = db
      .prepare("SELECT id AS category_id, name, COALESCE(group_name, '') AS group_name, savings_goal_id FROM categories WHERE savings_goal_id IS NOT NULL")
      .all() as { category_id: number; name: string; group_name: string; savings_goal_id: number }[];
    const assignedByGoal = new Map<number, number>();
    const linkedByGoal = new Map<number, { category_id: number; name: string; group_name: string }>();
    for (const r of linkRows) {
      const v = availableForCategory(db, r.category_id, r.name, month);
      assignedByGoal.set(r.savings_goal_id, (assignedByGoal.get(r.savings_goal_id) || 0) + v);
      // First linked category wins for display; multi-links (possible from the budget inspector)
      // still sum into the derived amount above.
      if (!linkedByGoal.has(r.savings_goal_id)) linkedByGoal.set(r.savings_goal_id, r);
    }
    // Expose the link so the UI can show where the goal is tied in the budget, disable the manual
    // saved field for derived goals, and let the modal link/unlink by category id.
    const withDerived = goals.map((g) => {
      const link = linkedByGoal.get(g.id);
      return {
        ...g,
        saved_amount: assignedByGoal.has(g.id) ? Math.round(assignedByGoal.get(g.id)! * 100) / 100 : g.saved_amount,
        derived: assignedByGoal.has(g.id),
        linked_category_id: link ? link.category_id : null,
        linked_category_name: link ? link.name : null,
        linked_group_name: link ? link.group_name : null,
      };
    });

    console.debug("[savings-goals] Loaded", withDerived.length, "savings goals,", assignedByGoal.size, "linked to budget");
    return NextResponse.json({ goals: withDerived });
  } catch (error) {
    console.error("[savings-goals] GET error:", error);
    return NextResponse.json({ goals: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const result = createSavingsGoal(body);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("[savings-goals] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    const result = updateSavingsGoal(body);
    if (!result.found) return NextResponse.json({ error: "Savings goal not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[savings-goals] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    deleteSavingsGoal(Number(body.id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[savings-goals] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
