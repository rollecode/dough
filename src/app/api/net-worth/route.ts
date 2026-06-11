/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const db = getDb();
    const snapshots = db
      .prepare("SELECT date, checking, savings, investments, debts, net_worth FROM net_worth_snapshots ORDER BY date ASC")
      .all() as any[];

    console.debug("[net-worth] Loaded", snapshots.length, "snapshots for user", user.id);

    return NextResponse.json({ snapshots });
  } catch (error) {
    console.error("[net-worth] GET error:", error);
    return NextResponse.json({ snapshots: [] }, { status: 500 });
  }
}

export async function POST() {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const db = getDb();

    // Compute from the local account cache, which is the source of truth in both YNAB and local
    // mode (kept fresh by sync). This lets net worth snapshots work without a YNAB connection.
    console.info("[net-worth] Taking snapshot for user", user.id);
    const accounts = db
      .prepare("SELECT type, balance FROM ynab_accounts WHERE closed = 0")
      .all() as { type: string; balance: number }[];

    const sumType = (type: string) => accounts.filter((a) => a.type === type).reduce((s, a) => s + a.balance, 0);
    const checking = sumType("checking");
    const savings = sumType("savings");
    const investments = sumType("otherAsset");
    const debtTotal = sumType("otherDebt");
    const netWorth = Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100;
    const today = new Date().toISOString().slice(0, 10);

    db.prepare(`
      INSERT INTO net_worth_snapshots (user_id, date, checking, savings, investments, debts, net_worth)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET
        checking = excluded.checking,
        savings = excluded.savings,
        investments = excluded.investments,
        debts = excluded.debts,
        net_worth = excluded.net_worth
    `).run(user.id, today, checking, savings, investments, debtTotal, netWorth);

    console.info("[net-worth] Snapshot saved:", { checking, savings, investments, debts: debtTotal, netWorth });

    return NextResponse.json({ success: true, snapshot: { date: today, checking, savings, investments, debts: debtTotal, net_worth: netWorth } });
  } catch (error) {
    console.error("[net-worth] POST error:", error);
    return NextResponse.json({ error: "Failed to take snapshot" }, { status: 500 });
  }
}
