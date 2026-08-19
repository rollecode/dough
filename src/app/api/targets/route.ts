import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { setCategoryTarget, clearCategoryTarget } from "@/lib/categories-write";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = getDb();
    const rows = db
      .prepare("SELECT category_id, monthly_amount, COALESCE(cadence, 'monthly') AS cadence, COALESCE(target_date, '') AS target_date, snooze_until_month FROM category_targets")
      .all() as { category_id: number; monthly_amount: number; cadence: string; target_date: string; snooze_until_month: string }[];

    console.debug("[targets] Loaded", rows.length, "targets");
    return NextResponse.json({ targets: rows });
  } catch (error) {
    console.error("[targets] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const result = setCategoryTarget(body);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.code || 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[targets] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const result = clearCategoryTarget(Number(body.category_id));
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.code || 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[targets] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
