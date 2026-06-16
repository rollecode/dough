/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getYnabToken, getYnabBudgetId } from "@/lib/household";
import { eventBus } from "@/lib/event-bus";

// Reconstruct a debt's balance over the last 12 months from its transactions and current balance.
// balance(month-end) = current - sum(transactions booked after that month-end). Returned as a
// positive amount (debt owed). Empty when the account has no transactions to chart.
function debtHistory(db: ReturnType<typeof getDb>, accountId: string, currentRaw: number) {
  const txns = db
    .prepare("SELECT date, amount FROM transactions WHERE account_id = ? ORDER BY date")
    .all(accountId) as { date: string; amount: number }[];
  if (txns.length === 0) return [] as { month: string; balance: number }[];
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const points: { month: string; balance: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // last day of that month
    const monthEnd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const after = txns.filter((t) => t.date > monthEnd).reduce((s, t) => s + t.amount, 0);
    points.push({
      month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
      balance: Math.round(Math.abs(currentRaw - after) * 100) / 100,
    });
  }
  return points;
}

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ debts: [] }, { status: 401 });

    const token = getYnabToken();
    const budgetId = getYnabBudgetId();
    const db = getDb();

    // Dual mode: live YNAB data when connected, otherwise the local debt accounts
    let debtAccounts: any[];
    let monthBudget: any = { categories: [] };
    if (token && budgetId) {
      console.info("[debts] Fetching debt data from YNAB");
      const { getBudgetSummary, getMonthBudget } = await import("@/lib/ynab/client");
      const [summary, mb] = await Promise.all([
        getBudgetSummary(budgetId, token),
        getMonthBudget(budgetId, undefined, token),
      ]);
      monthBudget = mb;
      debtAccounts = summary.accounts.filter((a: any) => a.type === "otherDebt" && a.balance < 0);
    } else {
      console.info("[debts] Reading debt accounts from local data");
      debtAccounts = db.prepare("SELECT id, name, balance FROM ynab_accounts WHERE type = 'otherDebt' AND closed = 0").all() as any[];
    }

    const overrides = db.prepare("SELECT * FROM debt_overrides").all() as any[];
    const overrideMap: Record<string, any> = {};
    for (const o of overrides) {
      overrideMap[o.ynab_account_id] = o;
    }

    // Amount paid toward each debt during the current calendar month, derived from the account's own
    // transactions (a payment reduces what is owed, i.e. a positive amount on a debt account). This
    // works in both YNAB and local mode and does not depend on a matching budget category.
    const paidRows = db.prepare(
      "SELECT account_id, COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS paid " +
        "FROM transactions WHERE date >= date('now', 'start of month') GROUP BY account_id"
    ).all() as { account_id: string; paid: number }[];
    const paidMonthMap: Record<string, number> = {};
    for (const r of paidRows) paidMonthMap[r.account_id] = r.paid;

    const debts = debtAccounts.map((a: any) => {
      const override = overrideMap[a.id];
      // Find matching category for payment info
      const matchingCat = monthBudget.categories.find((c: any) =>
        c.name.toLowerCase().includes(a.name.split("(")[0].trim().toLowerCase()) ||
        a.name.toLowerCase().includes(c.name.split("(")[0].trim().toLowerCase())
      );

      const monthlyTarget = matchingCat ? Math.abs(matchingCat.budgeted) : 0;
      const balance = Math.abs(a.balance);
      const history = debtHistory(db, a.id, a.balance);
      // Paid this month from real transactions, falling back to the YNAB category activity.
      const paidThisMonth = Math.round((paidMonthMap[a.id] ?? (matchingCat ? Math.abs(matchingCat.activity) : 0)) * 100) / 100;
      // Starting balance: user-set, otherwise suggested from the highest point in the recent history.
      const peakHistory = history.reduce((m, p) => Math.max(m, p.balance), 0);
      const originalAmount = override?.original_amount > 0 ? override.original_amount : 0;
      const suggestedOriginal = Math.round(Math.max(balance, peakHistory) * 100) / 100;
      const effectiveOriginal = originalAmount > 0 ? originalAmount : suggestedOriginal;
      const paidTotal = Math.round(Math.max(0, effectiveOriginal - balance) * 100) / 100;
      const percentPaid = effectiveOriginal > 0 ? Math.min(100, Math.round((paidTotal / effectiveOriginal) * 1000) / 10) : 0;

      return {
        id: a.id,
        name: a.name,
        balance,
        interestRate: override?.interest_rate ?? 0,
        minimumPayment: override?.minimum_payment ?? monthlyTarget,
        dueDay: override?.due_day ?? 0,
        monthlyTarget,
        monthlyPayment: paidThisMonth,
        originalAmount,
        suggestedOriginal,
        paidTotal,
        percentPaid,
        notes: override?.notes ?? "",
        sortOrder: override?.sort_order ?? 999,
        isPriority: override?.is_priority ?? 0,
        history,
      };
    });

    debts.sort((a: any, b: any) => a.sortOrder - b.sortOrder);

    // Snowball suggestion: pay smallest balance first
    const sorted = [...debts].sort((a, b) => a.balance - b.balance);
    const snowballTarget = sorted.find((d) => d.balance > 0);

    // Avalanche suggestion: pay highest interest first
    const sortedByRate = [...debts].sort((a, b) => b.interestRate - a.interestRate);
    const avalancheTarget = sortedByRate.find((d) => d.interestRate > 0 && d.balance > 0) || snowballTarget;

    console.info("[debts] Loaded", debts.length, "debts");

    return NextResponse.json({
      debts,
      suggestions: {
        snowball: snowballTarget ? {
          name: snowballTarget.name,
          balance: snowballTarget.balance,
          reason: "Smallest balance – quick win",
        } : null,
        avalanche: avalancheTarget ? {
          name: avalancheTarget.name,
          interestRate: avalancheTarget.interestRate,
          reason: "Highest interest – saves most money",
        } : null,
      },
      totalDebt: debts.reduce((s: number, d: any) => s + d.balance, 0),
      totalMonthlyPayment: debts.reduce((s: number, d: any) => s + d.monthlyPayment, 0),
    });
  } catch (error) {
    console.error("[debts] GET error:", error);
    return NextResponse.json({ debts: [], error: "Failed to load debts" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { ynab_account_id, interest_rate, minimum_payment, due_day, notes, original_amount } = body;

    if (!ynab_account_id) return NextResponse.json({ error: "Account ID required" }, { status: 400 });

    // Toggle priority only
    if (body.is_priority !== undefined && !due_day) {
      const db2 = getDb();
      db2.prepare("UPDATE debt_overrides SET is_priority = ?, updated_at = datetime('now') WHERE ynab_account_id = ?")
        .run(body.is_priority ? 1 : 0, ynab_account_id);
      console.info("[debts] Toggled priority for", ynab_account_id, ":", body.is_priority);
      eventBus.emit("data:updated", { source: "debt-priority-changed" });
      return NextResponse.json({ success: true });
    }

    if (due_day !== undefined && due_day !== 0 && (due_day < 1 || due_day > 31)) {
      return NextResponse.json({ error: "Due day must be 1-31" }, { status: 400 });
    }

    const db = getDb();
    db.prepare(`
      INSERT INTO debt_overrides (ynab_account_id, interest_rate, minimum_payment, due_day, notes)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(ynab_account_id) DO UPDATE SET
        interest_rate = excluded.interest_rate,
        minimum_payment = excluded.minimum_payment,
        due_day = excluded.due_day,
        notes = excluded.notes,
        updated_at = datetime('now')
    `).run(ynab_account_id, interest_rate ?? 0, minimum_payment ?? 0, due_day ?? 0, notes ?? "");

    // Only touch the starting balance when explicitly provided, so saving other fields never wipes it.
    if (original_amount !== undefined) {
      db.prepare("UPDATE debt_overrides SET original_amount = ?, updated_at = datetime('now') WHERE ynab_account_id = ?")
        .run(Math.abs(original_amount ?? 0), ynab_account_id);
    }

    console.info("[debts] Override saved for", ynab_account_id);
    eventBus.emit("data:updated", { source: "debt-updated" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[debts] PUT error:", error);
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
      INSERT INTO debt_overrides (ynab_account_id, sort_order) VALUES (?, ?)
      ON CONFLICT(ynab_account_id) DO UPDATE SET sort_order = excluded.sort_order, updated_at = datetime('now')
    `);
    const batch = db.transaction(() => {
      for (let i = 0; i < order.length; i++) {
        stmt.run(order[i], i);
      }
    });
    batch();

    console.info("[debts] Saved order for", order.length, "debts");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[debts] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
