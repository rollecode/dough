import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { availableForCategory } from "@/lib/budget-math";
import { eventBus } from "@/lib/event-bus";

// Point categories.savings_goal_id (the link the derivation follows) at the picked category:
// clear every previous link for this goal, then set the new one when a category was picked.
// A cleared picker (null/empty) therefore unlinks the goal back to manual saved-amount tracking.
function syncCategoryLink(db: ReturnType<typeof getDb>, goalId: number, categoryId: unknown) {
  db.prepare("UPDATE categories SET savings_goal_id = NULL WHERE savings_goal_id = ?").run(goalId);
  const catId = parseInt(String(categoryId ?? ""), 10);
  if (catId > 0) {
    db.prepare("UPDATE categories SET savings_goal_id = ? WHERE id = ?").run(goalId, catId);
    console.info("[savings-goals] Linked goal", goalId, "to category", catId);
  } else {
    console.info("[savings-goals] Unlinked goal", goalId, "from budget");
  }
}

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

    const body = await request.json();
    const { name, target_amount, ynab_category_id, ynab_category_name, target_date, description } = body;

    if (!name || !target_amount) {
      return NextResponse.json({ error: "Name and target amount required" }, { status: 400 });
    }

    const db = getDb();
    const result = db
      .prepare("INSERT INTO savings_goals (name, target_amount, priority, ynab_category_id, ynab_category_name, target_date, description) VALUES (?, ?, 'want', ?, ?, ?, ?)")
      .run(
        name,
        parseFloat(String(target_amount).replace(",", ".")),
        ynab_category_id || null,
        ynab_category_name || null,
        target_date || null,
        description || ""
      );

    // Maintain the derivation link too (categories.savings_goal_id): picking a category here must
    // actually tie the goal's progress to the budget, same as linking from the budget inspector.
    syncCategoryLink(db, Number(result.lastInsertRowid), ynab_category_id);

    console.info("[savings-goals] Created:", name, "id:", result.lastInsertRowid);
    eventBus.emit("data:updated", { source: "savings-goal-added" });
    return NextResponse.json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error("[savings-goals] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

    const db = getDb();

    // Toggle include_in_calculations
    if (body.include_in_calculations !== undefined && Object.keys(body).length === 2) {
      db.prepare("UPDATE savings_goals SET include_in_calculations = ?, updated_at = datetime('now') WHERE id = ?")
        .run(body.include_in_calculations ? 1 : 0, id);
      console.info("[savings-goals] Toggled calculations for", id, ":", body.include_in_calculations);
      eventBus.emit("data:updated", { source: "savings-goal-toggled" });
      return NextResponse.json({ success: true });
    }

    // Toggle active
    if (body.is_active !== undefined && Object.keys(body).length === 2) {
      db.prepare("UPDATE savings_goals SET is_active = ?, updated_at = datetime('now') WHERE id = ?")
        .run(body.is_active ? 1 : 0, id);
      console.info("[savings-goals] Toggled active for", id, ":", body.is_active);
      eventBus.emit("data:updated", { source: "savings-goal-toggled" });
      return NextResponse.json({ success: true });
    }

    // Full edit
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.name !== undefined) { updates.push("name = ?"); values.push(body.name); }
    if (body.target_amount !== undefined) { updates.push("target_amount = ?"); values.push(parseFloat(String(body.target_amount).replace(",", "."))); }
    if (body.saved_amount !== undefined) { updates.push("saved_amount = ?"); values.push(parseFloat(String(body.saved_amount).replace(",", "."))); }
    if (body.ynab_category_id !== undefined) { updates.push("ynab_category_id = ?"); values.push(body.ynab_category_id || null); }
    if (body.ynab_category_name !== undefined) { updates.push("ynab_category_name = ?"); values.push(body.ynab_category_name || null); }
    if (body.target_date !== undefined) { updates.push("target_date = ?"); values.push(body.target_date || null); }
    if (body.description !== undefined) { updates.push("description = ?"); values.push(body.description || ""); }
    if (body.include_in_calculations !== undefined) { updates.push("include_in_calculations = ?"); values.push(body.include_in_calculations ? 1 : 0); }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE savings_goals SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      // Keep the derivation link in sync with the picked category: selecting a category links the
      // goal's progress to the budget, selecting none unlinks it back to manual tracking. Multiple
      // links made from the budget inspector collapse to the single picked category on edit.
      if (body.ynab_category_id !== undefined) {
        syncCategoryLink(db, Number(id), body.ynab_category_id);
      }
      console.info("[savings-goals] Updated", id);
      eventBus.emit("data:updated", { source: "savings-goal-updated" });
    }

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

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

    const db = getDb();
    db.prepare("DELETE FROM savings_goals WHERE id = ?").run(id);
    // Clear the budget link so no category keeps pointing at a goal that no longer exists.
    db.prepare("UPDATE categories SET savings_goal_id = NULL WHERE savings_goal_id = ?").run(id);

    console.info("[savings-goals] Deleted", id);
    eventBus.emit("data:updated", { source: "savings-goal-deleted" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[savings-goals] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
