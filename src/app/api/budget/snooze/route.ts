import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { snoozeCategory, unsnoozeCategory } from "@/lib/budget-writes";

// Snooze/unsnooze a category for a single month.
export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { category_id, month } = await request.json().catch(() => ({}));
    const result = snoozeCategory(category_id, month);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[budget/snooze] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { category_id, month } = await request.json().catch(() => ({}));
    const result = unsnoozeCategory(category_id, month);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[budget/snooze] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
