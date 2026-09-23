import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dashboardFor } from "@/lib/dashboard-for";

// GET /api/dashboard-model - the model /api/v1/dashboard answers the app with, for the signed-in
// browser. The web's pace line is drawn from this, so the page and the phone read one computation
// instead of two that drift apart.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    return NextResponse.json(dashboardFor(user.id));
  } catch (error) {
    console.error("[dashboard-model] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
