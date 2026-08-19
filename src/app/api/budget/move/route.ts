import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moveBudget } from "@/lib/budget-writes";

// Move assigned money between two categories within a month (YNAB "move money"/"cover overspending").
export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const result = moveBudget(body);
    if ("error" in result) return NextResponse.json({ error: result.error, available: result.available }, { status: 400 });
    return NextResponse.json({ success: true, moved: result.moved });
  } catch (error) {
    console.error("[budget/move] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
