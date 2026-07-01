import { NextResponse } from "next/server";
import { apiRoute, resolveMonth } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

// POST /api/v1/budget/assign { month?, category_id | category_name, budgeted } - set (not add) the
// budgeted amount for one category in a month (write scope). Mirrors the budget page's assign box.
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const month = /^\d{4}-\d{2}$/.test(String(body.month || "")) ? String(body.month) : resolveMonth(request);
  const budgeted = Number(body.budgeted);
  if (!isFinite(budgeted)) {
    return NextResponse.json({ error: "budgeted (number) required" }, { status: 400 });
  }

  const db = getDb();
  let categoryId = Number(body.category_id) || 0;
  let categoryName = "";
  if (categoryId) {
    const row = db.prepare("SELECT name FROM categories WHERE id = ? AND is_active = 1").get(categoryId) as { name: string } | undefined;
    if (!row) return NextResponse.json({ error: `No active category with id ${categoryId}` }, { status: 404 });
    categoryName = row.name;
  } else if (body.category_name) {
    const row = db.prepare("SELECT id, name FROM categories WHERE name = ? AND is_active = 1").get(String(body.category_name)) as { id: number; name: string } | undefined;
    if (!row) return NextResponse.json({ error: `No active category named "${body.category_name}"` }, { status: 404 });
    categoryId = row.id;
    categoryName = row.name;
  } else {
    return NextResponse.json({ error: "category_id or category_name required" }, { status: 400 });
  }

  const value = Math.round(budgeted * 100) / 100;
  db.prepare(
    "INSERT INTO monthly_category_budgets (month, category_id, budgeted) VALUES (?, ?, ?) " +
      "ON CONFLICT(month, category_id) DO UPDATE SET budgeted = excluded.budgeted, updated_at = datetime('now')"
  ).run(month, categoryId, value);
  eventBus.emit("data:updated", { source: "api-v1-budget-assign" });
  console.info("[api/v1/budget/assign]", month, "cat", categoryId, "->", value);
  return { success: true, month, category_id: categoryId, category_name: categoryName, budgeted: value };
});
