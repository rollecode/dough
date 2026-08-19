import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { updateSubscription } from "@/lib/subscriptions";

// POST /api/v1/subscriptions/update (write). Body: { id, name?, amount?, due_day?, brand_color?, brand_logo?, is_priority?, is_active?, mark_paid? }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const result = updateSubscription(body);
  if (!result.found) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  return { success: true };
});
