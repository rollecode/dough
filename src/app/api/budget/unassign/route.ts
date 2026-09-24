import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";
import { applyUnassign } from "@/lib/auto-assign";

// The web's over-assigned fix, the same write as POST /api/v1/budget/unassign.
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { month } = await request.json().catch(() => ({}));
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  const { unassigned, plan } = applyUnassign(getDb(), month);
  if (plan.length > 0) eventBus.emit("data:updated", { source: "budget-unassign" });
  return NextResponse.json({ success: true, unassigned, count: plan.length });
}
