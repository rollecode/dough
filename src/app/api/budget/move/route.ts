import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";
import { availableForCategory } from "@/lib/budget-math";

// Move assigned money between two categories within a month.
// Decreasing the source's assigned lowers its available; increasing the
// destination's assigned raises its available. Total assigned (and therefore
// ready-to-assign) is unchanged, matching YNAB's "move money" / "cover overspending".
export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const month = String(body.month || "");
    const fromId = Number(body.from_category_id);
    const toId = Number(body.to_category_id);
    const amount = Math.round(Number(body.amount) * 100) / 100;

    if (!month || !fromId || !toId) {
      return NextResponse.json({ error: "month, from_category_id, to_category_id required" }, { status: 400 });
    }
    if (fromId === toId) {
      return NextResponse.json({ error: "Cannot move money to the same category" }, { status: 400 });
    }
    if (!isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
    }

    const db = getDb();
    const nameOf = (id: number): string =>
      (db.prepare("SELECT name FROM categories WHERE id = ?").get(id) as { name: string } | undefined)?.name || "";
    const current = (id: number): number =>
      (db.prepare("SELECT COALESCE(budgeted, 0) AS v FROM monthly_category_budgets WHERE month = ? AND category_id = ?").get(month, id) as { v: number } | undefined)?.v || 0;

    // Never let a move pull more than the source actually has available, which would
    // manufacture negative available out of thin air. Clamp to the source's available.
    const sourceAvailable = availableForCategory(db, fromId, nameOf(fromId), month);
    const moveAmount = Math.round(Math.min(amount, Math.max(0, sourceAvailable)) * 100) / 100;
    if (moveAmount <= 0) {
      return NextResponse.json({ error: "Source category has no available money to move", available: sourceAvailable }, { status: 400 });
    }
    if (moveAmount < amount) {
      console.info("[budget/move] Clamped move from", amount, "to", moveAmount, "(source available", sourceAvailable + ")");
    }

    const upsert = db.prepare(
      "INSERT INTO monthly_category_budgets (month, category_id, budgeted) VALUES (?, ?, ?) " +
        "ON CONFLICT(month, category_id) DO UPDATE SET budgeted = excluded.budgeted, updated_at = datetime('now')"
    );

    const move = db.transaction(() => {
      const fromNew = Math.round((current(fromId) - moveAmount) * 100) / 100;
      const toNew = Math.round((current(toId) + moveAmount) * 100) / 100;
      upsert.run(month, fromId, fromNew);
      upsert.run(month, toId, toNew);
    });
    move();

    console.info("[budget/move]", month, "moved", moveAmount, "from cat", fromId, "to cat", toId);
    eventBus.emit("data:updated", { source: "budget-move" });
    return NextResponse.json({ success: true, moved: moveAmount });
  } catch (error) {
    console.error("[budget/move] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
