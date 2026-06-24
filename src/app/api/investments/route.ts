/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { localDateIso } from "@/lib/date-utils";

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

    const body = await request.json();
    const { ynab_account_id, monthly_contribution, expected_return, notes, ticker } = body;

    if (!ynab_account_id) return NextResponse.json({ error: "Account ID required" }, { status: 400 });

    const db = getDb();
    const acct = db.prepare("SELECT balance FROM ynab_accounts WHERE id = ?").get(ynab_account_id) as { balance: number } | undefined;
    const prev = db.prepare("SELECT contributed FROM investment_overrides WHERE ynab_account_id = ?").get(ynab_account_id) as { contributed: number | null } | undefined;
    const oldBalance = acct?.balance ?? 0;

    // New reconciled market value (updates the balance when provided).
    const hasValue = body.value !== undefined && body.value !== null && body.value !== "";
    const newValue = hasValue ? (parseFloat(String(body.value)) || 0) : oldBalance;

    // Cost basis: a new investment seeds it from its initial value; otherwise grow the existing basis
    // (or the old value, if untracked) by any money added now. Market re-values never change it.
    const added = parseFloat(String(body.added ?? 0)) || 0;
    let contributed: number;
    if (body.init_contributed !== undefined && body.init_contributed !== null) {
      contributed = Math.round((parseFloat(String(body.init_contributed)) || 0) * 100) / 100;
    } else {
      const baseline = prev?.contributed != null ? prev.contributed : oldBalance;
      contributed = Math.round((baseline + added) * 100) / 100;
    }

    const apply = db.transaction(() => {
      if (hasValue) {
        db.prepare("UPDATE ynab_accounts SET balance = ?, updated_at = datetime('now') WHERE id = ?").run(newValue, ynab_account_id);
      }
      db.prepare(`
        INSERT INTO investment_overrides (ynab_account_id, monthly_contribution, expected_return, notes, ticker, contributed)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(ynab_account_id) DO UPDATE SET
          monthly_contribution = excluded.monthly_contribution,
          expected_return = excluded.expected_return,
          notes = excluded.notes,
          ticker = excluded.ticker,
          contributed = excluded.contributed,
          updated_at = datetime('now')
      `).run(ynab_account_id, monthly_contribution ?? 0, expected_return ?? 7, notes ?? "", ticker ?? "", contributed);

      // Snapshot today's totals (one row per day) for the progress chart.
      const totals = db.prepare(
        "SELECT COALESCE(SUM(a.balance), 0) AS value, COALESCE(SUM(COALESCE(o.contributed, a.balance)), 0) AS invested " +
          "FROM ynab_accounts a LEFT JOIN investment_overrides o ON o.ynab_account_id = a.id " +
          "WHERE a.type = 'otherAsset' AND a.closed = 0"
      ).get() as { value: number; invested: number };
      const today = localDateIso();
      db.prepare(
        "INSERT INTO investment_progress (date, total_value, total_contributed) VALUES (?, ?, ?) " +
          "ON CONFLICT(date) DO UPDATE SET total_value = excluded.total_value, total_contributed = excluded.total_contributed"
      ).run(today, Math.round(totals.value * 100) / 100, Math.round(totals.invested * 100) / 100);
    });
    apply();

    console.info("[investments] Saved", ynab_account_id, "value:", newValue, "added:", added, "contributed:", contributed);
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

    const body = await request.json();
    const { order } = body;
    if (!Array.isArray(order)) return NextResponse.json({ error: "order array required" }, { status: 400 });

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO investment_overrides (ynab_account_id, sort_order) VALUES (?, ?)
      ON CONFLICT(ynab_account_id) DO UPDATE SET sort_order = excluded.sort_order, updated_at = datetime('now')
    `);
    const batch = db.transaction(() => {
      for (let i = 0; i < order.length; i++) {
        stmt.run(order[i], i);
      }
    });
    batch();

    console.info("[investments] Saved order for", order.length, "investments");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[investments] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
