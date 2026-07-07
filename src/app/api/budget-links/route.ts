import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBudgetLink, setBudgetLink, isLinkType } from "@/lib/budget-links";
import { eventBus } from "@/lib/event-bus";

// Generic budget-link endpoint for the finance modals (savings goals, subscriptions, debts,
// investments): read where a thing is linked in the budget, and link/unlink it to a category.
// GET  /api/budget-links?type=subscription&id=12 -> { category: {category_id, category_name, group_name} | null }
// POST /api/budget-links { type, id, category_id | null } -> link (or unlink with null)

export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "";
    const id = url.searchParams.get("id") || "";
    if (!isLinkType(type) || !id) {
      return NextResponse.json({ error: "type and id required" }, { status: 400 });
    }
    const category = getBudgetLink(getDb(), type, id);
    console.debug("[budget-links] GET", type, id, "->", category ? category.category_name : "unlinked");
    return NextResponse.json({ category });
  } catch (error) {
    console.error("[budget-links] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const type = String(body.type || "");
    const id = body.id;
    if (!isLinkType(type) || id === undefined || id === null || id === "") {
      return NextResponse.json({ error: "type and id required" }, { status: 400 });
    }
    const linked = setBudgetLink(getDb(), type, id, body.category_id);
    eventBus.emit("data:updated", { source: "budget-link-changed" });
    return NextResponse.json({ success: true, linked });
  } catch (error) {
    console.error("[budget-links] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
