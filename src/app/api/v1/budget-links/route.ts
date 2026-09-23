import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { getBudgetLink, setBudgetLink, isLinkType } from "@/lib/budget-links";
import { eventBus } from "@/lib/event-bus";

// GET /api/v1/budget-links?type=bill&id=12 (read) - which budget category a bill, subscription,
// savings goal, debt or investment is linked to: { category: { category_id, category_name,
// group_name } | null }.
// POST /api/v1/budget-links (write) - link it, or unlink with category_id null.
// Body: { type, id, category_id }. The same library the web's budget link control uses.
export const GET = apiRoute("read", (request) => {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "";
  const id = url.searchParams.get("id") || "";
  if (!isLinkType(type) || !id) return NextResponse.json({ error: "type and id required" }, { status: 400 });
  return { category: getBudgetLink(getDb(), type, id) };
});

export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const type = String(body.type || "");
  const id = body.id;
  if (!isLinkType(type) || id === undefined || id === null || id === "") {
    return NextResponse.json({ error: "type and id required" }, { status: 400 });
  }
  const linked = setBudgetLink(getDb(), type, id, body.category_id);
  eventBus.emit("data:updated", { source: "api-v1-budget-link-changed" });
  return { success: true, linked };
});
