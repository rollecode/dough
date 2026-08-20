import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createIncome, updateIncome, deleteIncome } from "@/lib/income-write";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ incomes: [] }, { status: 401 });

    const db = getDb();
    const incomes = db
      .prepare("SELECT id, name, amount, expected_day, is_recurring, is_active, target_account_id FROM income_sources ORDER BY expected_day ASC")
      .all() as { id: number; name: string; amount: number; expected_day: number; is_recurring: number; is_active: number; target_account_id: string }[];

    // Get averages from history
    const averages = db
      .prepare("SELECT income_id, AVG(amount) as avg_amount, COUNT(*) as count FROM income_amount_history GROUP BY income_id")
      .all() as { income_id: number; avg_amount: number; count: number }[];
    const avgMap = new Map(averages.map((a) => [a.income_id, { avg: Math.round(a.avg_amount * 100) / 100, count: a.count }]));

    const enriched = incomes.map((i) => {
      const avg = avgMap.get(i.id);
      return {
        ...i,
        average_amount: avg?.avg || null,
        history_count: avg?.count || 0,
      };
    });

    console.debug("[income] Loaded", incomes.length, "income sources");
    return NextResponse.json({ incomes: enriched });
  } catch (error) {
    console.error("[income] GET error:", error);
    return NextResponse.json({ incomes: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const result = createIncome(user.id, body);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("[income] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    const result = updateIncome(body);
    if (!result.found) return NextResponse.json({ error: "Income source not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[income] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    deleteIncome(body.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[income] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
