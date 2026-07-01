import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ categories: [] }, { status: 401 });

    const { getDb } = await import("@/lib/db");
    const { getBudgetMode } = await import("@/lib/household");
    const db = getDb();

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Local mode: the frozen ynab_categories rows are empty for months added since the cutover, so
    // read the live category list from the local categories table instead.
    const categories = getBudgetMode() === "local"
      ? db.prepare(
          "SELECT name, COALESCE(group_name, '') as 'group' FROM categories WHERE is_active = 1 AND name != 'Inflow: Ready to Assign' ORDER BY group_name, name"
        ).all() as { name: string; group: string }[]
      : db.prepare(
          "SELECT name, group_name as 'group' FROM ynab_categories WHERE month = ? AND name != 'Inflow: Ready to Assign' ORDER BY name"
        ).all(currentMonth) as { name: string; group: string }[];

    console.debug("[ynab/categories] Serving", categories.length, "categories from SQLite");
    return NextResponse.json({ categories });
  } catch (error) {
    console.error("[ynab/categories] Error:", error);
    return NextResponse.json({ categories: [] }, { status: 500 });
  }
}
