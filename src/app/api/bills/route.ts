/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";
import { billDueInMonth } from "@/lib/bills";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ bills: [] }, { status: 401 });

    const db = getDb();
    const bills = db
      .prepare("SELECT id, name, amount, due_day, category, is_active, is_priority, COALESCE(cadence, 'monthly') AS cadence, due_month FROM recurring_bills ORDER BY due_day ASC")
      .all() as any[];

    // Get matches for this month
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const matches = db
      .prepare("SELECT source_id, amount FROM monthly_matches WHERE source_type = 'bill' AND month = ?")
      .all(month) as { source_id: number; amount: number }[];
    const matchMap = new Map(matches.map((m) => [m.source_id, m.amount]));

    // Get payee patterns with full data
    const patterns = db
      .prepare("SELECT id, source_id, payee_pattern, min_amount, max_amount FROM payee_matches WHERE source_type = 'bill'")
      .all() as { id: number; source_id: number; payee_pattern: string; min_amount: number; max_amount: number }[];
    const patternMap = new Map<number, { id: number; payee_pattern: string; min_amount: number; max_amount: number }[]>();
    for (const p of patterns) {
      if (!patternMap.has(p.source_id)) patternMap.set(p.source_id, []);
      patternMap.get(p.source_id)!.push({ id: p.id, payee_pattern: p.payee_pattern, min_amount: p.min_amount || 0, max_amount: p.max_amount || 0 });
    }

    // Get average amounts from history
    const averages = db
      .prepare("SELECT bill_id, AVG(amount) as avg_amount, COUNT(*) as count FROM bill_amount_history GROUP BY bill_id")
      .all() as { bill_id: number; avg_amount: number; count: number }[];
    const avgMap = new Map(averages.map((a) => [a.bill_id, { avg: a.avg_amount, count: a.count }]));

    // Get manual paid status
    const manualStatuses = db
      .prepare("SELECT bill_id, is_paid, paid_amount FROM bill_manual_status WHERE month = ?")
      .all(month) as { bill_id: number; is_paid: number; paid_amount: number | null }[];
    const manualMap = new Map(manualStatuses.map((m) => [m.bill_id, m]));

    const today = now.getDate();
    const currentMonth1 = now.getMonth() + 1;
    const enriched = bills.map((b: any) => {
      const manual = manualMap.get(b.id);
      const autoMatched = matchMap.has(b.id);
      const isPaid = manual ? !!manual.is_paid : autoMatched;
      const paidAmount = manual?.paid_amount || matchMap.get(b.id) || null;
      // A yearly bill is only overdue/due-soon inside its due month; the other months it is dormant.
      const dueThisMonth = billDueInMonth(b, currentMonth1);
      const isOverdue = !isPaid && b.is_active && dueThisMonth && b.due_day < today;
      const isDueSoon = !isPaid && b.is_active && dueThisMonth && b.due_day >= today && b.due_day <= today + 3;
      const avg = avgMap.get(b.id);

      const amountDiff = paidAmount && paidAmount !== b.amount ? paidAmount - b.amount : null;

      return {
        ...b,
        is_paid: isPaid,
        is_manual_paid: !!manual?.is_paid,
        paid_amount: paidAmount || null,
        amount_diff: amountDiff,
        is_overdue: isOverdue,
        is_due_soon: isDueSoon,
        patterns: patternMap.get(b.id) || [],
        average_amount: avg ? Math.round(avg.avg * 100) / 100 : null,
        history_count: avg?.count || 0,
      };
    });

    console.debug("[bills] Loaded", bills.length, "bills,", matches.length, "paid this month");
    return NextResponse.json({ bills: enriched });
  } catch (error) {
    console.error("[bills] GET error:", error);
    return NextResponse.json({ bills: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { name, amount, due_day, category } = body;

    if (!name || !amount || !due_day) {
      return NextResponse.json({ error: "Name, amount and due day required" }, { status: 400 });
    }

    const cadence = body.cadence === "yearly" ? "yearly" : "monthly";
    const dueMonth = cadence === "yearly" ? Math.min(12, Math.max(1, parseInt(String(body.due_month), 10) || 1)) : null;

    const db = getDb();
    const result = db
      .prepare("INSERT INTO recurring_bills (user_id, name, amount, due_day, category, cadence, due_month) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(user.id, name, parseFloat(String(amount).replace(",", ".")), due_day, category || "", cadence, dueMonth);

    console.info("[bills] Created bill:", name, "id:", result.lastInsertRowid);
    eventBus.emit("data:updated", { source: "bill-added" });
    return NextResponse.json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error("[bills] POST error:", error);
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

    // Manual paid/unpaid toggle
    if (body.mark_paid !== undefined) {
      const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      if (body.mark_paid) {
        db.prepare(`
          INSERT INTO bill_manual_status (bill_id, month, is_paid, paid_amount) VALUES (?, ?, 1, ?)
          ON CONFLICT(bill_id, month) DO UPDATE SET is_paid = 1, paid_amount = excluded.paid_amount
        `).run(id, month, body.paid_amount || null);
        console.info("[bills] Manually marked bill", id, "as paid");
      } else {
        db.prepare(`
          INSERT INTO bill_manual_status (bill_id, month, is_paid, paid_amount) VALUES (?, ?, 0, NULL)
          ON CONFLICT(bill_id, month) DO UPDATE SET is_paid = 0, paid_amount = NULL
        `).run(id, month);
        console.info("[bills] Manually marked bill", id, "as unpaid");
      }
      eventBus.emit("data:updated", { source: "bill-status-changed" });
      return NextResponse.json({ success: true });
    }

    // Toggle priority
    if (body.is_priority !== undefined && Object.keys(body).length === 2) {
      db.prepare("UPDATE recurring_bills SET is_priority = ?, updated_at = datetime('now') WHERE id = ?")
        .run(body.is_priority ? 1 : 0, id);
      console.info("[bills] Toggled bill", id, "priority:", body.is_priority);
      eventBus.emit("data:updated", { source: "bill-priority-changed" });
      return NextResponse.json({ success: true });
    }

    // Toggle active
    if (body.is_active !== undefined && Object.keys(body).length === 2) {
      db.prepare("UPDATE recurring_bills SET is_active = ?, updated_at = datetime('now') WHERE id = ?")
        .run(body.is_active ? 1 : 0, id);
      console.info("[bills] Toggled bill", id, "active:", body.is_active);
      eventBus.emit("data:updated", { source: "bill-toggled" });
      return NextResponse.json({ success: true });
    }

    // Full edit
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (body.name !== undefined) { updates.push("name = ?"); values.push(body.name); }
    if (body.amount !== undefined) {
      const newAmount = parseFloat(String(body.amount).replace(",", "."));
      updates.push("amount = ?");
      values.push(newAmount);

      // Record amount history
      const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      db.prepare(`
        INSERT INTO bill_amount_history (bill_id, amount, month) VALUES (?, ?, ?)
        ON CONFLICT(bill_id, month) DO UPDATE SET amount = excluded.amount
      `).run(id, newAmount, month);
    }
    if (body.due_day !== undefined) { updates.push("due_day = ?"); values.push(body.due_day); }
    if (body.category !== undefined) { updates.push("category = ?"); values.push(body.category); }
    if (body.cadence !== undefined) {
      const cadence = body.cadence === "yearly" ? "yearly" : "monthly";
      updates.push("cadence = ?"); values.push(cadence);
      // Keep due_month consistent with cadence: set it for yearly, clear it for monthly.
      updates.push("due_month = ?");
      values.push(cadence === "yearly" ? Math.min(12, Math.max(1, parseInt(String(body.due_month), 10) || 1)) : null);
    } else if (body.due_month !== undefined) {
      updates.push("due_month = ?"); values.push(Math.min(12, Math.max(1, parseInt(String(body.due_month), 10) || 1)));
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE recurring_bills SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      console.info("[bills] Updated bill", id);
      eventBus.emit("data:updated", { source: "bill-updated" });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[bills] PUT error:", error);
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
    db.prepare("DELETE FROM recurring_bills WHERE id = ?").run(id);

    console.info("[bills] Deleted bill", id);
    eventBus.emit("data:updated", { source: "bill-deleted" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[bills] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
