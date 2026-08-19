import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { createSubscription } from "@/lib/subscriptions";

// POST /api/v1/subscriptions/create (write). Body: { name, amount, due_day, brand_color?, brand_logo? }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const result = createSubscription(body);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return { success: true, id: result.id };
});
