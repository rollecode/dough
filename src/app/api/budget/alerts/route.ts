import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { availableForCategory } from "@/lib/budget-math";

// Actionable budget state for the current month, used to show a notice dot on the Budjetti nav
// item. "Overspent" = a category whose available balance has gone negative (YNAB's red
// overbudgeted state). Reuses the canonical per-category available math so it matches the
// budget page exactly. Snoozed categories and Ready-to-Assign are excluded.
export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = getDb();
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    console.debug("[budget/alerts] Computing overspent categories for", month);

    const cats = db
      .prepare("SELECT id, name FROM categories WHERE is_active = 1")
      .all() as { id: number; name: string }[];
    const snoozed = new Set(
      (db.prepare("SELECT category_id FROM category_snoozes WHERE month = ?").all(month) as { category_id: number }[])
        .map((r) => r.category_id)
    );

    let overspent = 0;
    for (const c of cats) {
      if (snoozed.has(c.id) || c.name === "Inflow: Ready to Assign") continue;
      const available = availableForCategory(db, c.id, c.name, month);
      if (available < -0.005) overspent++;
    }

    console.info("[budget/alerts] overspent categories:", overspent);
    return NextResponse.json({ overspent });
  } catch (err) {
    console.error("[budget/alerts] error:", err);
    return NextResponse.json({ overspent: 0 });
  }
}
