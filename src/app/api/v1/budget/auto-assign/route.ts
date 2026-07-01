import { NextResponse } from "next/server";
import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";
import { computeAutoAssign, applyAutoAssign, AUTO_ASSIGN_MODES, type AutoAssignMode } from "@/lib/auto-assign";

// GET /api/v1/budget/auto-assign?month=YYYY-MM[&mode=...] - preview only, no writes.
//   Without mode: the total each mode would assign. With mode: the full per-category plan.
export const GET = apiRoute("read", (request) => {
  const db = getDb();
  const month = resolveMonth(request);
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode) {
    if (!AUTO_ASSIGN_MODES.includes(mode as AutoAssignMode)) {
      return NextResponse.json({ error: `mode must be one of ${AUTO_ASSIGN_MODES.join(", ")}` }, { status: 400 });
    }
    const { total, plan } = computeAutoAssign(db, month, mode as AutoAssignMode);
    return { month, mode, total, plan };
  }
  const previews: Record<string, number> = {};
  for (const m of AUTO_ASSIGN_MODES) previews[m] = computeAutoAssign(db, month, m).total;
  return { month, previews };
});

// POST /api/v1/budget/auto-assign { month, mode } - apply the plan (write scope). Funds category
// targets from Ready to Assign, capped so it never overbudgets.
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const month = /^\d{4}-\d{2}$/.test(String(body.month || "")) ? String(body.month) : resolveMonth(request);
  const mode = body.mode;
  if (!AUTO_ASSIGN_MODES.includes(mode)) {
    return NextResponse.json({ error: `mode must be one of ${AUTO_ASSIGN_MODES.join(", ")}` }, { status: 400 });
  }
  const db = getDb();
  const { assigned, count, plan } = applyAutoAssign(db, month, mode as AutoAssignMode);
  eventBus.emit("data:updated", { source: "api-v1-auto-assign" });
  console.info("[api/v1/budget/auto-assign]", month, "mode", mode, "assigned", assigned, "count", count);
  return { success: true, month, mode, assigned, count, plan };
});
