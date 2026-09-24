import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";
import { applyUnassign } from "@/lib/auto-assign";

// POST /api/v1/budget/unassign { month } (write scope) - clear over-assigning: take back unspent
// money from this month's assignments until Ready to Assign is zero. Does nothing when it is not
// below zero.
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const month = /^\d{4}-\d{2}$/.test(String(body.month || "")) ? String(body.month) : resolveMonth(request);
  const { unassigned, plan } = applyUnassign(getDb(), month);
  if (plan.length > 0) eventBus.emit("data:updated", { source: "api-v1-unassign" });
  return { success: true, month, unassigned, plan };
});
