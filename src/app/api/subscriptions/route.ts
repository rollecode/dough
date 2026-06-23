import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ subscriptions: [] }, { status: 401 });

    const db = getDb();
    const subscriptions = db
      .prepare("SELECT * FROM subscriptions ORDER BY due_day ASC")
      .all();

    // Get matches for this month
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const matches = db
      .prepare("SELECT source_id, amount FROM monthly_matches WHERE source_type = 'subscription' AND month = ?")
      .all(month) as { source_id: number; amount: number }[];
    const matchMap = new Map(matches.map((m) => [m.source_id, m.amount]));

    // Get payee patterns with IDs for deletion
    const patterns = db
      .prepare("SELECT id, source_id, payee_pattern, min_amount, max_amount FROM payee_matches WHERE source_type = 'subscription'")
      .all() as { id: number; source_id: number; payee_pattern: string; min_amount: number; max_amount: number }[];
    const patternMap = new Map<number, { id: number; pattern: string; min_amount: number; max_amount: number }[]>();
    for (const p of patterns) {
      if (!patternMap.has(p.source_id)) patternMap.set(p.source_id, []);
      patternMap.get(p.source_id)!.push({ id: p.id, pattern: p.payee_pattern, min_amount: p.min_amount, max_amount: p.max_amount });
    }

    // Manual paid status (subscription IDs offset by 10000 to avoid collision with bills)
    const manualStatuses = db
      .prepare("SELECT bill_id, is_paid FROM bill_manual_status WHERE month = ? AND bill_id >= 10000")
      .all(month) as { bill_id: number; is_paid: number }[];
    const manualMap = new Map(manualStatuses.map((m) => [m.bill_id - 10000, m]));

    const today = now.getDate();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const enriched = (subscriptions as any[]).map((s) => {
      const manual = manualMap.get(s.id);
      const autoMatched = matchMap.has(s.id);
      const isPaid = manual ? !!manual.is_paid : autoMatched;
      const isOverdue = !isPaid && s.is_active && s.due_day < today;
      return {
        ...s,
        is_paid: isPaid,
        is_overdue: isOverdue,
        patterns: patternMap.get(s.id) || [],
      };
    });

    console.debug("[subscriptions] Loaded", subscriptions.length, "subscriptions");
    return NextResponse.json({ subscriptions: enriched });
  } catch (error) {
    console.error("[subscriptions] GET error:", error);
    return NextResponse.json({ subscriptions: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { name, amount, due_day, brand_color, brand_logo } = body;

    if (!name || !amount || !due_day) {
      return NextResponse.json({ error: "Name, amount and due day required" }, { status: 400 });
    }

    const db = getDb();
    const result = db
      .prepare("INSERT INTO subscriptions (name, amount, due_day, brand_color, brand_logo) VALUES (?, ?, ?, ?, ?)")
      .run(name, parseFloat(String(amount).replace(",", ".")), due_day, brand_color || "#6366f1", brand_logo || "");

    console.info("[subscriptions] Created:", name, "id:", result.lastInsertRowid);
    eventBus.emit("data:updated", { source: "subscription-added" });
    return NextResponse.json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error("[subscriptions] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

    const db = getDb();

    // Toggle priority
    if (body.is_priority !== undefined && Object.keys(body).length === 2) {
      db.prepare("UPDATE subscriptions SET is_priority = ?, updated_at = datetime('now') WHERE id = ?")
        .run(body.is_priority ? 1 : 0, id);
      console.info("[subscriptions] Toggled", id, "priority:", body.is_priority);
      eventBus.emit("data:updated", { source: "subscription-priority-changed" });
      return NextResponse.json({ success: true });
    }

    // Manual paid/unpaid toggle
    if (body.mark_paid !== undefined) {
      const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      const offsetId = id + 10000;
      if (body.mark_paid) {
        db.prepare(`
          INSERT INTO bill_manual_status (bill_id, month, is_paid) VALUES (?, ?, 1)
          ON CONFLICT(bill_id, month) DO UPDATE SET is_paid = 1
        `).run(offsetId, month);
        console.info("[subscriptions] Manually marked", id, "as paid");
      } else {
        db.prepare(`
          INSERT INTO bill_manual_status (bill_id, month, is_paid) VALUES (?, ?, 0)
          ON CONFLICT(bill_id, month) DO UPDATE SET is_paid = 0
        `).run(offsetId, month);
        console.info("[subscriptions] Manually marked", id, "as unpaid");
      }
      eventBus.emit("data:updated", { source: "subscription-status-changed" });
      return NextResponse.json({ success: true });
    }

    if (body.is_active !== undefined && Object.keys(body).length === 2) {
      db.prepare("UPDATE subscriptions SET is_active = ?, updated_at = datetime('now') WHERE id = ?")
        .run(body.is_active ? 1 : 0, id);
      console.info("[subscriptions] Toggled", id, "active:", body.is_active);
      eventBus.emit("data:updated", { source: "subscription-toggled" });
      return NextResponse.json({ success: true });
    }

    const updates: string[] = [];
    const values: (string | number)[] = [];
    if (body.name !== undefined) { updates.push("name = ?"); values.push(body.name); }
    if (body.amount !== undefined) { updates.push("amount = ?"); values.push(parseFloat(String(body.amount).replace(",", "."))); }
    if (body.due_day !== undefined) { updates.push("due_day = ?"); values.push(body.due_day); }
    if (body.brand_color !== undefined) { updates.push("brand_color = ?"); values.push(body.brand_color); }
    if (body.brand_logo !== undefined) { updates.push("brand_logo = ?"); values.push(body.brand_logo); }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE subscriptions SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      console.info("[subscriptions] Updated", id);
      eventBus.emit("data:updated", { source: "subscription-updated" });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[subscriptions] PUT error:", error);
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
    db.prepare("DELETE FROM subscriptions WHERE id = ?").run(id);
    db.prepare("DELETE FROM payee_matches WHERE source_type = 'subscription' AND source_id = ?").run(id);

    console.info("[subscriptions] Deleted", id);
    eventBus.emit("data:updated", { source: "subscription-deleted" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[subscriptions] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
