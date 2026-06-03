import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = getDb();
    const rows = db
      .prepare("SELECT category_id, monthly_amount, snooze_until_month FROM category_targets")
      .all() as { category_id: number; monthly_amount: number; snooze_until_month: string }[];

    console.debug("[targets] Loaded", rows.length, "targets");
    return NextResponse.json({ targets: rows });
  } catch (error) {
    console.error("[targets] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const category_id = Number(body.category_id);
    if (!category_id) return NextResponse.json({ error: "category_id required" }, { status: 400 });

    const db = getDb();
    const existing = db
      .prepare("SELECT id, monthly_amount, snooze_until_month FROM category_targets WHERE category_id = ?")
      .get(category_id) as { id: number; monthly_amount: number; snooze_until_month: string } | undefined;

    const monthly = body.monthly_amount !== undefined
      ? (isFinite(Number(body.monthly_amount)) ? Math.round(Number(body.monthly_amount) * 100) / 100 : 0)
      : existing?.monthly_amount || 0;
    const snooze = body.snooze_until_month !== undefined
      ? String(body.snooze_until_month || "")
      : existing?.snooze_until_month || "";

    if (existing) {
      db.prepare(
        "UPDATE category_targets SET monthly_amount = ?, snooze_until_month = ?, updated_at = datetime('now') WHERE category_id = ?"
      ).run(monthly, snooze, category_id);
    } else {
      db.prepare(
        "INSERT INTO category_targets (category_id, monthly_amount, snooze_until_month) VALUES (?, ?, ?)"
      ).run(category_id, monthly, snooze);
    }

    console.info("[targets] Set category", category_id, "monthly:", monthly, "snooze:", snooze);
    eventBus.emit("data:updated", { source: "targets-changed" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[targets] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { category_id } = await request.json();
    if (!category_id) return NextResponse.json({ error: "category_id required" }, { status: 400 });

    const db = getDb();
    db.prepare("DELETE FROM category_targets WHERE category_id = ?").run(category_id);

    console.info("[targets] Cleared target for category", category_id);
    eventBus.emit("data:updated", { source: "targets-cleared" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[targets] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
