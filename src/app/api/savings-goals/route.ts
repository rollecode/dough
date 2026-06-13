import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ goals: [] }, { status: 401 });

    const db = getDb();
    const goals = db
      .prepare("SELECT * FROM savings_goals ORDER BY created_at ASC")
      .all();

    console.debug("[savings-goals] Loaded", (goals as unknown[]).length, "savings goals");
    return NextResponse.json({ goals });
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

    console.info("[savings-goals] Deleted", id);
    eventBus.emit("data:updated", { source: "savings-goal-deleted" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[savings-goals] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
