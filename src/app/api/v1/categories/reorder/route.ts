import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { reorderCategories } from "@/lib/categories-write";
import { setHouseholdSetting } from "@/lib/household";
import { eventBus } from "@/lib/event-bus";

// POST /api/v1/categories/reorder (write) - set the order categories are listed in, and which group
// each belongs to. Body: { items: [{ id, group_name }] } for a full re-lay, or { order: [id, ...] }
// to reorder within the groups they already have. Pass { groups: [name, ...] } to order the groups
// themselves, exactly as the budget page saves them.
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));

  if (Array.isArray(body.groups)) {
    setHouseholdSetting("budget_group_order", JSON.stringify(body.groups.map(String)));
    eventBus.emit("data:updated", { source: "api-v1-groups-reordered" });
    if (!Array.isArray(body.items) && !Array.isArray(body.order)) {
      return { success: true, groups: body.groups.length };
    }
  }

  const result = reorderCategories(body);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.code ?? 400 });
  }
  return { success: true };
});
