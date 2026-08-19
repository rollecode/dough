import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createCategory, updateCategory, deleteCategory, reorderCategories } from "@/lib/categories-write";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = getDb();
    const rows = db
      .prepare("SELECT id, name, group_name, sort_order, color, is_active FROM categories ORDER BY group_name, sort_order, name")
      .all() as { id: number; name: string; group_name: string; sort_order: number; color: string; is_active: number }[];

    console.debug("[categories] Loaded", rows.length, "rows");
    return NextResponse.json({ categories: rows });
  } catch (error) {
    console.error("[categories] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const result = createCategory(body);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.code || 400 });
    return NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("[categories] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    const result = updateCategory(body);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.code || 400 });
    if (!result.found) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[categories] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const result = reorderCategories(body);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.code || 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[categories] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    const result = deleteCategory(body);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.code || 400 });
    if (!result.found) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    return NextResponse.json({ success: true, deleted: true, reassigned: result.reassigned });
  } catch (error) {
    console.error("[categories] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
