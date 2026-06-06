import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

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

    const body = await request.json();
    const name = (body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const db = getDb();
    const exists = db.prepare("SELECT id FROM categories WHERE name = ?").get(name) as { id: number } | undefined;
    if (exists) return NextResponse.json({ error: "Category name already exists" }, { status: 409 });

    const groupName = (body.group_name || "").trim();
    const color = (body.color || "").trim();
    const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories").get() as { m: number }).m;
    const result = db
      .prepare("INSERT INTO categories (name, group_name, sort_order, color) VALUES (?, ?, ?, ?)")
      .run(name, groupName, maxOrder + 1, color);

    console.info("[categories] Created", name, "id:", result.lastInsertRowid);
    eventBus.emit("data:updated", { source: "categories-added" });
    return NextResponse.json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error("[categories] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const id = body.id;
    if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

    const db = getDb();
    const updates: string[] = [];
    const values: (string | number)[] = [];
    let renameFrom = "";
    let renameTo = "";
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      const dup = db.prepare("SELECT id FROM categories WHERE name = ? AND id != ?").get(name, id) as { id: number } | undefined;
      if (dup) return NextResponse.json({ error: "Another category already has that name" }, { status: 409 });
      const old = db.prepare("SELECT name FROM categories WHERE id = ?").get(id) as { name: string } | undefined;
      if (old && old.name !== name) { renameFrom = old.name; renameTo = name; }
      updates.push("name = ?"); values.push(name);
    }
    if (body.group_name !== undefined) { updates.push("group_name = ?"); values.push(String(body.group_name).trim()); }
    if (body.description !== undefined) { updates.push("description = ?"); values.push(String(body.description)); }
    if (body.color !== undefined) { updates.push("color = ?"); values.push(String(body.color).trim()); }
    if (body.is_active !== undefined) { updates.push("is_active = ?"); values.push(body.is_active ? 1 : 0); }
    if (body.sort_order !== undefined) { updates.push("sort_order = ?"); values.push(parseInt(String(body.sort_order), 10) || 0); }

    if (updates.length === 0) return NextResponse.json({ success: true });

    updates.push("updated_at = datetime('now')");
    values.push(id);
    // Transactions reference the category by name, so a rename must rewrite their history too,
    // otherwise the renamed category loses all its past activity and carryover.
    const apply = db.transaction(() => {
      db.prepare(`UPDATE categories SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      if (renameFrom && renameTo) {
        const res = db.prepare("UPDATE transactions SET category = ? WHERE category = ?").run(renameTo, renameFrom);
        console.info("[categories] Renamed", renameFrom, "->", renameTo, "rewrote", res.changes, "transactions");
      }
    });
    apply();

    console.info("[categories] Updated id", id);
    eventBus.emit("data:updated", { source: "categories-updated" });
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

    const body = await request.json();
    const db = getDb();

    // New shape: items carry both order (by index) and group membership so a drag can
    // reorder and move a category to another group in one call. Legacy shape: order (ids only).
    if (Array.isArray(body.items)) {
      const items = body.items as { id: number; group_name: string }[];
      const stmt = db.prepare("UPDATE categories SET sort_order = ?, group_name = ?, updated_at = datetime('now') WHERE id = ?");
      const tx = db.transaction(() => {
        items.forEach((it, idx) => stmt.run(idx, String(it.group_name ?? "").trim(), Number(it.id)));
      });
      tx();
      console.info("[categories] Reordered and regrouped", items.length, "categories");
      eventBus.emit("data:updated", { source: "categories-reordered" });
      return NextResponse.json({ success: true });
    }

    const order: number[] = body.order;
    if (!Array.isArray(order)) return NextResponse.json({ error: "items or order array required" }, { status: 400 });

    const stmt = db.prepare("UPDATE categories SET sort_order = ?, updated_at = datetime('now') WHERE id = ?");
    const tx = db.transaction(() => {
      order.forEach((id, idx) => stmt.run(idx, id));
    });
    tx();

    console.info("[categories] Reordered", order.length, "categories");
    eventBus.emit("data:updated", { source: "categories-reordered" });
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

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

    const db = getDb();
    // Soft delete via is_active to preserve historical references on transactions
    db.prepare("UPDATE categories SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);

    console.info("[categories] Soft-deleted id", id);
    eventBus.emit("data:updated", { source: "categories-deleted" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[categories] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
