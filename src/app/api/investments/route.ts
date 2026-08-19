/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { updateInvestment, reorderInvestments } from "@/lib/investments-write";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ investments: [] }, { status: 401 });

    const db = getDb();

    // Get YNAB investment accounts from SQLite
    const investmentAccounts = db.prepare("SELECT id, name, balance FROM ynab_accounts WHERE type = 'otherAsset' AND closed = 0 ORDER BY name").all() as { id: string; name: string; balance: number }[];

    if (investmentAccounts.length === 0) {
      return NextResponse.json({ investments: [], error: "No investment accounts. Sync first." });
    }

    // Get transactions for monthly transfer detection
    const now2 = new Date();
    const monthStr2 = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, "0")}`;
    const transactions = db.prepare("SELECT amount, account_id, date FROM transactions WHERE date >= ?").all(monthStr2 + "-01") as { amount: number; account_id: string; date: string }[];

    // Load overrides from DB
    const overrides = db.prepare("SELECT * FROM investment_overrides").all() as any[];
    const overrideMap: Record<string, any> = {};
    for (const o of overrides) {
      overrideMap[o.ynab_account_id] = o;
    }

    // Find monthly transfers to each investment account
    const investments = investmentAccounts.map((a: any) => {
      const override = overrideMap[a.id];

      // Find transfer transactions TO this account this month
      const transfersIn = transactions.filter((t: any) =>
        t.amount > 0 &&
        t.account_id === a.id
      );
      const monthlyTransferred = transfersIn.reduce((s: number, t: any) => s + t.amount, 0);

      // Cost basis: explicit contributed when tracked, otherwise the current value (so profit starts
      // at zero). Profit = current value minus what was put in.
      const invested = override?.contributed != null ? override.contributed : a.balance;
      return {
        id: a.id,
        name: a.name,
        balance: a.balance,
        invested: Math.round(invested * 100) / 100,
        profit: Math.round((a.balance - invested) * 100) / 100,
        monthlyContribution: override?.monthly_contribution ?? 0,
        expectedReturn: override?.expected_return ?? 7,
        monthlyTransferred: Math.round(monthlyTransferred * 100) / 100,
        notes: override?.notes ?? "",
        ticker: override?.ticker ?? "",
        sortOrder: override?.sort_order ?? 999,
      };
    });

    investments.sort((a: any, b: any) => a.sortOrder - b.sortOrder);

    // Manual value-over-time snapshots for the "Your progress" chart.
    const progress = db.prepare("SELECT date, total_value AS value, total_contributed AS invested FROM investment_progress ORDER BY date ASC").all() as { date: string; value: number; invested: number }[];

    const totalValue = investments.reduce((s: number, i: any) => s + i.balance, 0);
    const totalInvested = investments.reduce((s: number, i: any) => s + i.invested, 0);
    console.info("[investments] Loaded", investments.length, "investment accounts,", progress.length, "progress points");
    return NextResponse.json({
      investments,
      progress,
      totalValue: Math.round(totalValue * 100) / 100,
      totalInvested: Math.round(totalInvested * 100) / 100,
      totalProfit: Math.round((totalValue - totalInvested) * 100) / 100,
      totalMonthly: investments.reduce((s: number, i: any) => s + i.monthlyContribution, 0),
    });
  } catch (error) {
    console.error("[investments] GET error:", error);
    return NextResponse.json({ investments: [], error: "Failed to load investments" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body.ynab_account_id) return NextResponse.json({ error: "Account ID required" }, { status: 400 });
    const result = updateInvestment(body);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[investments] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.order)) return NextResponse.json({ error: "order array required" }, { status: 400 });
    reorderInvestments(body.order);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[investments] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
