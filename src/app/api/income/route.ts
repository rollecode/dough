import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ incomes: [] }, { status: 401 });

    const db = getDb();
    const incomes = db
      .prepare("SELECT id, name, amount, expected_day, is_recurring, is_active, target_account_id FROM income_sources ORDER BY expected_day ASC")
      .all() as { id: number; name: string; amount: number; expected_day: number; is_recurring: number; is_active: number; target_account_id: string }[];

    // Get averages from history
    const averages = db
      .prepare("SELECT income_id, AVG(amount) as avg_amount, COUNT(*) as count FROM income_amount_history GROUP BY income_id")
      .all() as { income_id: number; avg_amount: number; count: number }[];
    const avgMap = new Map(averages.map((a) => [a.income_id, { avg: Math.round(a.avg_amount * 100) / 100, count: a.count }]));

    const enriched = incomes.map((i) => {
      const avg = avgMap.get(i.id);
      return {
        ...i,
        average_amount: avg?.avg || null,
        history_count: avg?.count || 0,
      };
    });

    console.debug("[income] Loaded", incomes.length, "income sources");
    return NextResponse.json({ incomes: enriched });
  } catch (error) {
    console.error("[income] GET error:", error);
    return NextResponse.json({ incomes: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { name, amount, expected_day, is_recurring } = body;

    if (!name || !amount || !expected_day) {
      return NextResponse.json({ error: "Name, amount and expected day required" }, { status: 400 });
    }

    const db = getDb();
    const result = db
      .prepare("INSERT INTO income_sources (user_id, name, amount, expected_day, is_recurring) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, name, amount, expected_day, is_recurring ? 1 : 0);

    console.info("[income] Created income source:", name, "id:", result.lastInsertRowid);
    eventBus.emit("data:updated", { source: "income-added" });
    return NextResponse.json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error("[income] POST error:", error);
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

    // Toggle active
    if (body.is_active !== undefined && Object.keys(body).length === 2) {
      db.prepare("UPDATE income_sources SET is_active = ?, updated_at = datetime('now') WHERE id = ?")
        .run(body.is_active ? 1 : 0, id);
      console.info("[income] Toggled income source", id, "active:", body.is_active);
      return NextResponse.json({ success: true });
    }

    // Full edit
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (body.name !== undefined) { updates.push("name = ?"); values.push(body.name); }
    if (body.amount !== undefined) {
      const newAmount = parseFloat(String(body.amount).replace(",", "."));
      updates.push("amount = ?");
      values.push(newAmount);
      // Record amount history
      const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      db.prepare(`
        INSERT INTO income_amount_history (income_id, amount, month) VALUES (?, ?, ?)
        ON CONFLICT(income_id, month) DO UPDATE SET amount = excluded.amount
      `).run(id, newAmount, month);
    }
    if (body.expected_day !== undefined) { updates.push("expected_day = ?"); values.push(body.expected_day); }
    if (body.is_recurring !== undefined) { updates.push("is_recurring = ?"); values.push(body.is_recurring ? 1 : 0); }
    if (body.is_active !== undefined) { updates.push("is_active = ?"); values.push(body.is_active ? 1 : 0); }
    if (body.target_account_id !== undefined) { updates.push("target_account_id = ?"); values.push(body.target_account_id || ""); }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE income_sources SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      console.info("[income] Updated income source", id);
    }

    eventBus.emit("data:updated", { source: "income-updated" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[income] PUT error:", error);
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
    db.prepare("DELETE FROM income_sources WHERE id = ?").run(id);

    console.info("[income] Deleted income source", id);
    eventBus.emit("data:updated", { source: "income-deleted" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[income] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
