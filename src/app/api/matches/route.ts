import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = getDb();
    const patterns = db.prepare("SELECT * FROM payee_matches ORDER BY source_type, source_id").all();

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthlyMatches = db.prepare("SELECT * FROM monthly_matches WHERE month = ?").all(month) as any[];

    // Manual income received/not-received overrides win over auto-match
    const manualIncome = db.prepare("SELECT income_id, is_received FROM income_manual_status WHERE month = ?").all(month) as { income_id: number; is_received: number }[];
    const manualMap = new Map(manualIncome.map((m) => [m.income_id, !!m.is_received]));

    // Effective income received set: manual override wins, otherwise auto-match presence
    const autoIncomeIds = new Set(monthlyMatches.filter((m) => m.source_type === "income").map((m) => m.source_id));
    const incomeReceived: { source_id: number; source_type: string }[] = [];
    const allIncomeIds = new Set<number>([...autoIncomeIds, ...manualMap.keys()]);
    for (const id of allIncomeIds) {
      const received = manualMap.has(id) ? manualMap.get(id)! : autoIncomeIds.has(id);
      if (received) incomeReceived.push({ source_id: id, source_type: "income" });
    }
    // Keep non-income matches as-is, replace income matches with effective set
    const effectiveMatches = [...monthlyMatches.filter((m) => m.source_type !== "income"), ...incomeReceived];

    console.debug("[matches] Loaded", (patterns as any[]).length, "patterns,", monthlyMatches.length, "monthly matches,", manualIncome.length, "manual income overrides");

    return NextResponse.json({ patterns, monthlyMatches: effectiveMatches, month, manualIncome });
  } catch (error) {
    console.error("[matches] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { source_type, source_id, payee_pattern, min_amount, max_amount } = body;

    if (!source_type || !source_id || !payee_pattern) {
      return NextResponse.json({ error: "source_type, source_id and payee_pattern required" }, { status: 400 });
    }

    const db = getDb();
    const result = db
      .prepare("INSERT INTO payee_matches (source_type, source_id, payee_pattern, min_amount, max_amount) VALUES (?, ?, ?, ?, ?)")
      .run(source_type, source_id, payee_pattern, min_amount || 0, max_amount || 0);

    console.info("[matches] Added pattern:", payee_pattern, "for", source_type, source_id);
    return NextResponse.json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error("[matches] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { id, payee_pattern, min_amount, max_amount } = body;
    if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

    const db = getDb();
    const updates: string[] = [];
    const values: (string | number)[] = [];
    if (payee_pattern !== undefined) { updates.push("payee_pattern = ?"); values.push(payee_pattern); }
    if (min_amount !== undefined) { updates.push("min_amount = ?"); values.push(min_amount); }
    if (max_amount !== undefined) { updates.push("max_amount = ?"); values.push(max_amount); }

    if (updates.length > 0) {
      values.push(id);
      db.prepare(`UPDATE payee_matches SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      console.info("[matches] Updated pattern ID:", id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[matches] PUT error:", error);
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
    db.prepare("DELETE FROM payee_matches WHERE id = ?").run(id);

    console.info("[matches] Removed pattern ID:", id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[matches] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
