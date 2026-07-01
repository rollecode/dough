import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";
import { computeAutoAssign, applyAutoAssign, AUTO_ASSIGN_MODES, type AutoAssignMode } from "@/lib/auto-assign";

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
    for (const m of AUTO_ASSIGN_MODES) out[m] = computeAutoAssign(db, month, m).total;
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
    if (!AUTO_ASSIGN_MODES.includes(mode)) return NextResponse.json({ error: "invalid mode" }, { status: 400 });

    const db = getDb();
    const { assigned, count } = applyAutoAssign(db, month, mode as AutoAssignMode);

    console.info("[budget/auto-assign]", month, "mode", mode, "assigned", assigned, "across", count, "categories");
    eventBus.emit("data:updated", { source: "budget-auto-assign" });
    return NextResponse.json({ success: true, assigned, count });
  } catch (error) {
    console.error("[budget/auto-assign] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
