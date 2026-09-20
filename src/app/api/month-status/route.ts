import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { currentMonthStatus } from "@/lib/month-status";

// GET /api/month-status - the month's income and its end-of-month cost, computed on the server so
// the dashboard card reads the same figure the API reports to a phone.
export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(currentMonthStatus());
  } catch (error) {
    console.error("[month-status] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
