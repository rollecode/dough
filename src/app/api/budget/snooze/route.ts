import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

// Snooze a category for a single month: it drops out of the normal list into the snoozed
// group and its target stops counting for that month.
export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { category_id, month } = await request.json();
    if (!category_id || !/^\d{4}-\d{2}$/.test(String(month || ""))) {
      return NextResponse.json({ error: "category_id and month=YYYY-MM required" }, { status: 400 });
    }
    getDb().prepare("INSERT OR IGNORE INTO category_snoozes (category_id, month) VALUES (?, ?)").run(category_id, month);
    console.info("[budget/snooze] Snoozed category", category_id, "for", month);
    eventBus.emit("data:updated", { source: "category-snoozed" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[budget/snooze] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { category_id, month } = await request.json();
    if (!category_id || !month) return NextResponse.json({ error: "category_id and month required" }, { status: 400 });
    getDb().prepare("DELETE FROM category_snoozes WHERE category_id = ? AND month = ?").run(category_id, month);
    console.info("[budget/snooze] Unsnoozed category", category_id, "for", month);
    eventBus.emit("data:updated", { source: "category-unsnoozed" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[budget/snooze] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
