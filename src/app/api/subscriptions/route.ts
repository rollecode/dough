import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createSubscription, updateSubscription, deleteSubscription } from "@/lib/subscriptions";

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
    const body = await request.json().catch(() => ({}));
    const result = createSubscription(body);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("[subscriptions] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    const result = updateSubscription(body);
    if (!result.found) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
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
    const body = await request.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    deleteSubscription(Number(body.id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[subscriptions] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
