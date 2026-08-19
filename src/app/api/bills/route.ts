/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { billDueInMonth } from "@/lib/bills";
import { createBill, updateBill, deleteBill } from "@/lib/bills-write";

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
    const body = await request.json().catch(() => ({}));
    const result = createBill(user.id, body);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("[bills] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    const result = updateBill(body);
    if (!result.found) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
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
    const body = await request.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    deleteBill(body.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[bills] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
