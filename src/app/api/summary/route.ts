import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getYnabToken, getYnabBudgetId, getHouseholdSetting } from "@/lib/household";
import { DEFAULT_SUMMARY_INSTRUCTIONS } from "@/lib/ai/default-prompts";
import { spawn } from "child_process";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";

    // Household-wide off switch for AI summaries
    if (getHouseholdSetting("ai_summaries_disabled") === "1") {
      return NextResponse.json({ summary: null, disabled: true });
    }

    const db = getDb();

    // Ensure table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        locale TEXT NOT NULL DEFAULT 'en',
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const requestLocale = url.searchParams.get("locale") || "en";

    // Check for cached summary — shared across all users, excluding hidden ones
    if (!forceRefresh) {
      const cached = db
        .prepare("SELECT id, content, created_at FROM ai_summaries WHERE locale = ? AND is_hidden = 0 ORDER BY created_at DESC LIMIT 1")
        .get(requestLocale) as { id: number; content: string; created_at: string } | undefined;

      if (cached) {
        console.debug("[summary] Returning cached", requestLocale, "summary from", cached.created_at);
        return NextResponse.json({ id: cached.id, summary: cached.content, cached: true, created_at: cached.created_at });
      }
    }

    console.info("[summary] Generating fresh AI summary for user", user.id);

    // Get YNAB data from household settings
    const token = getYnabToken();
    const budgetId = getYnabBudgetId();

    const now = new Date();

    // YNAB cache when connected, otherwise assemble the same shape from local data
    const cached = db.prepare("SELECT data FROM ynab_cache WHERE id = 1").get() as { data: string } | undefined;
    let summary: any, transactions: any, monthBudget: any;
    if (token && budgetId && cached) {
      ({ summary, transactions, monthBudget } = JSON.parse(cached.data));
    } else {
      const { buildLocalFinancialData } = await import("@/lib/local-financial-data");
      ({ summary, transactions, monthBudget } = buildLocalFinancialData(db));
    }

    // Load historical monthly data for comparisons
    const billMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const historySnapshots = db
      .prepare("SELECT month, income, expenses FROM monthly_snapshots WHERE month < ? ORDER BY month DESC LIMIT 3")
      .all(billMonth) as { month: string; income: number; expenses: number }[];

    const { getHouseholdSetting: getExcludedSetting } = await import("@/lib/household");
    const excludedRaw = getExcludedSetting("budget_excluded_accounts");
    const excludedIds: string[] = excludedRaw ? JSON.parse(excludedRaw) : [];

    const checkingSavings = summary.accounts
      .filter((a: any) => (a.type === "checking" || a.type === "savings") && !excludedIds.includes(a.id))
      .reduce((s: number, a: any) => s + a.balance, 0);

    // Load account notes for context
    const accountNotesRows = db
      .prepare("SELECT ynab_account_id, note FROM account_notes WHERE note != ''")
      .all() as { ynab_account_id: string; note: string }[];
    const accountNotesMap: Record<string, string> = {};
    for (const r of accountNotesRows) accountNotesMap[r.ynab_account_id] = r.note;

    const accountsList = summary.accounts
      .filter((a: any) => a.type === "checking" || a.type === "savings" || a.type === "otherAsset")
      .map((a: any) => `${a.name}: ${Math.round(a.balance)} euros (${a.type})${accountNotesMap[a.id] ? ` — ${accountNotesMap[a.id]}` : ""}`)
      .join(", ");

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - now.getDate();
    // Use local transactions table for fresh data (same as dashboard)
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const localTx = db.prepare(
      "SELECT date, payee, amount, category FROM transactions WHERE date >= ? GROUP BY ynab_id ORDER BY date DESC"
    ).all(monthStart) as { date: string; payee: string; amount: number; category: string }[];
    const realExpenses = localTx.filter((t) => t.amount < 0 && !t.payee.startsWith("Transfer") && !t.payee.startsWith("Starting Balance") && !t.payee.startsWith("Reconciliation") && t.category !== "Uncategorized");
    const realIncome = localTx.filter((t) => t.amount > 0 && !t.payee.startsWith("Transfer") && !t.payee.startsWith("Starting Balance") && !t.payee.startsWith("Reconciliation"));
    const monthActivity = realExpenses.reduce((s: number, t) => s + Math.abs(t.amount), 0);
    const monthIncomeTotal = monthBudget.income;

    const topExpenses = realExpenses
      .sort((a: any, b: any) => a.amount - b.amount)
      .slice(0, 5)
      .map((t: any) => `${t.payee}: ${Math.abs(t.amount).toFixed(0)} euros`)
      .join(", ");

    const lang = requestLocale === "fi"
      ? "Respond in Finnish."
      : "Respond in English.";

    const householdProfile = getHouseholdSetting("household_profile") || "";

    const daysPassed = now.getDate();

    // Get income sources and bills from DB
    const incomeSources = db
      .prepare("SELECT name, amount, expected_day, is_active FROM income_sources WHERE is_active = 1 ORDER BY expected_day ASC")
      .all() as { name: string; amount: number; expected_day: number; is_active: number }[];

    const recurringBills = db
      .prepare("SELECT id, name, amount, due_day, is_active FROM recurring_bills WHERE is_active = 1 ORDER BY due_day ASC")
      .all() as { id: number; name: string; amount: number; due_day: number; is_active: number }[];

    // Merge subscriptions into bills for unified calculations
    const subscriptionRows = db
      .prepare("SELECT id, name, amount, due_day FROM subscriptions WHERE is_active = 1")
      .all() as { id: number; name: string; amount: number; due_day: number }[];
    for (const sub of subscriptionRows) {
      recurringBills.push({ id: sub.id + 10000, name: sub.name, amount: sub.amount, due_day: sub.due_day, is_active: 1 });
    }

    const billMatches = db
      .prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'bill' AND month = ?")
      .all(billMonth) as { source_id: number }[];
    const subMatchesSummary = db
      .prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'subscription' AND month = ?")
      .all(billMonth) as { source_id: number }[];
    // Manual overrides take priority over auto-match
    const manualStatuses = db
      .prepare("SELECT bill_id, is_paid FROM bill_manual_status WHERE month = ?")
      .all(billMonth) as { bill_id: number; is_paid: number }[];
    const manualPaidMap = new Map(manualStatuses.map((m) => [m.bill_id, !!m.is_paid]));

    const autoMatchedIds = new Set([
      ...billMatches.map((m) => m.source_id),
      ...subMatchesSummary.map((m) => m.source_id + 10000),
    ]);
    // Build effective paid set: manual override wins, then auto-match
    const matchedBillIds = new Set(
      recurringBills.filter((b) => {
        if (manualPaidMap.has(b.id)) return manualPaidMap.get(b.id);
        return autoMatchedIds.has(b.id);
      }).map((b) => b.id)
    );

    const upcomingIncome = incomeSources
      .filter((i) => i.expected_day > now.getDate())
      .reduce((s, i) => s + i.amount, 0);

    const totalExpectedMonthlyIncome = Math.max(monthIncomeTotal, incomeSources.reduce((s, i) => s + i.amount, 0));

    // Better projection: separate bills from discretionary spending
    const totalBillsAmount = recurringBills.reduce((s, b) => s + b.amount, 0);
    const paidBillsAmount = recurringBills
      .filter((b) => matchedBillIds.has(b.id))
      .reduce((s, b) => s + b.amount, 0);
    const unpaidBillsAmount = totalBillsAmount - paidBillsAmount;
    const discretionarySpending = Math.max(0, monthActivity - paidBillsAmount);
    const dailyDiscretionary = daysPassed > 0 ? Math.round((discretionarySpending / daysPassed) * 100) / 100 : 0;
    const projectedMonthEnd = Math.round(checkingSavings + upcomingIncome - unpaidBillsAmount - (dailyDiscretionary * daysLeft));

    // Category breakdown for spending tips
    const categoryBreakdown = monthBudget.categories
      .filter((c: { name: string; activity: number }) => c.activity < 0 && c.name !== "Inflow: Ready to Assign")
      .sort((a: { activity: number }, b: { activity: number }) => a.activity - b.activity)
      .slice(0, 8)
      .map((c: { name: string; activity: number }) => `${c.name}: ${Math.abs(c.activity).toFixed(0)} euros`)
      .join(", ");

    const incomeList = incomeSources.length > 0
      ? incomeSources.map((i) => `${i.name}: ${i.amount} euros (day ${i.expected_day})`).join(", ")
      : "No income sources configured";

    // Get debts with overrides
    const debtOverrides = db.prepare("SELECT * FROM debt_overrides").all() as { ynab_account_id: string; interest_rate: number; minimum_payment: number; due_day: number }[];
    const debtOverrideMap: Record<string, { interest_rate: number; minimum_payment: number; due_day: number }> = {};
    for (const o of debtOverrides) debtOverrideMap[o.ynab_account_id] = o;

    const debtAccounts: { name: string; balance: number; rate: number; payment: number; dueDay: number }[] = summary.accounts
      .filter((a: any) => a.type === "otherDebt" && a.balance < 0)
      .map((a: any) => {
        const override = debtOverrideMap[a.id];
        return { name: a.name, balance: Math.abs(a.balance), rate: override?.interest_rate ?? 0, payment: override?.minimum_payment ?? 0, dueDay: override?.due_day ?? 0 };
      });

    // Get investment accounts with overrides
    const investOverrides = db.prepare("SELECT * FROM investment_overrides").all() as { ynab_account_id: string; monthly_contribution: number; expected_return: number }[];
    const investOverrideMap: Record<string, { monthly_contribution: number; expected_return: number }> = {};
    for (const o of investOverrides) investOverrideMap[o.ynab_account_id] = o;

    const investmentAccounts: { name: string; balance: number; monthly: number; returnPct: number }[] = summary.accounts
      .filter((a: any) => a.type === "otherAsset")
      .map((a: any) => {
        const override = investOverrideMap[a.id];
        return { name: a.name, balance: a.balance, monthly: override?.monthly_contribution ?? 0, returnPct: override?.expected_return ?? 7 };
      });

    const savingGoal = parseFloat(getHouseholdSetting("saving_rate") || "0");

    // Monthly debt and investment payments (same as dashboard)
    const totalDebtPayments = debtAccounts.reduce((s, d) => s + d.payment, 0);
    const totalInvestmentContributions = investmentAccounts.reduce((s: number, i: { monthly: number }) => s + i.monthly, 0);

    const summaryInstructions = getHouseholdSetting("prompt_summary_instructions") || DEFAULT_SUMMARY_INSTRUCTIONS;

    const projectedRemainingExpenses = Math.round(unpaidBillsAmount + (dailyDiscretionary * daysLeft));
    const projectedTotalExpenses = Math.round(monthActivity + projectedRemainingExpenses);

    // Daily budget via shared cash flow simulation
    const resolveDay = (day: number) => day === 0 ? daysInMonth : day;
    const { calculateDailyBudget } = await import("@/lib/daily-budget");

    const incomeMatches = db
      .prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'income' AND month = ?")
      .all(billMonth) as { source_id: number }[];
    const matchedIncomeIds = new Set(incomeMatches.map((m) => m.source_id));

    const incomeWithIds = db
      .prepare("SELECT id, amount, expected_day FROM income_sources WHERE is_active = 1")
      .all() as { id: number; amount: number; expected_day: number }[];

    const allDebtItems = debtAccounts.map((d) => ({ amount: d.payment, dueDay: d.dueDay }));
    const budgetParams = {
      balance: checkingSavings,
      savingGoal,
      today: daysPassed,
      daysInMonth,
      unpaidBills: recurringBills.filter((b) => !matchedBillIds.has(b.id)).map((b) => ({ amount: b.amount, dueDay: b.due_day })),
      debts: allDebtItems,
      unreceivedIncomes: incomeWithIds
        .filter((i) => resolveDay(i.expected_day) > daysPassed && !matchedIncomeIds.has(i.id))
        .map((i) => ({ amount: i.amount, expectedDay: i.expected_day })),
      allIncomes: incomeWithIds.map((i) => ({ amount: i.amount, expectedDay: i.expected_day })),
      allBills: recurringBills.map((b) => ({ amount: b.amount, dueDay: b.due_day })),
      allDebts: allDebtItems,
      resolveDay,
    };
    const billsSetting = getExcludedSetting("budget_include_bills") || "auto";
    const budgetWithBills = calculateDailyBudget(budgetParams);
    const budgetWithoutBills = calculateDailyBudget({ ...budgetParams, unpaidBills: [], debts: [] });
    let dailyBudget: number;
    if (billsSetting === "auto") {
      const totalUnpaid = budgetParams.unpaidBills.reduce((s: number, b: { amount: number }) => s + b.amount, 0) + budgetParams.debts.reduce((s: number, d: { amount: number }) => s + d.amount, 0);
      const thresholdNormal = parseInt(getExcludedSetting("budget_threshold_normal") || "30", 10);
      const canAfford = checkingSavings > totalUnpaid && budgetWithBills.dailyBudget >= thresholdNormal;
      dailyBudget = canAfford ? budgetWithBills.dailyBudget : budgetWithoutBills.dailyBudget;
    } else if (billsSetting === "1") {
      dailyBudget = budgetWithBills.dailyBudget;
    } else {
      dailyBudget = budgetWithoutBills.dailyBudget;
    }

    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const weekday = weekdays[now.getDay()];

    const prompt = `${lang} You are a personal finance advisor.${householdProfile ? ` Household: ${householdProfile}.` : ""} ${summaryInstructions}

Today is ${weekday} ${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}.

CRITICAL RULES:
- Use the PRE-CALCULATED projected month-end balance below. Do NOT calculate your own projection.
- The projection already accounts for: current balance + upcoming income - unpaid bills - projected discretionary spending.
- Income arrives at specific dates, not all at once. Do not treat upcoming income as already available.
- The daily burn rate EXCLUDES fixed bills (rent etc) - it only reflects discretionary spending like groceries, restaurants, transport.

Pre-calculated analysis:
- Accounts: ${accountsList}
- Current checking+savings balance: ${Math.round(checkingSavings)} euros
- Days passed: ${daysPassed}, days left in month: ${daysLeft}
- Income received so far: ${Math.round(monthIncomeTotal)} euros
- Income still coming: ${Math.round(upcomingIncome)} euros (${incomeSources.filter((i) => i.expected_day > now.getDate()).map((i) => `${i.name}: ${i.amount} euros on day ${i.expected_day}`).join(", ") || "none"})
- Total expected monthly income: ${totalExpectedMonthlyIncome} euros
- Spending so far this month: ${Math.round(monthActivity)} euros
- Of which fixed bills already paid: ${Math.round(paidBillsAmount)} euros
- Of which discretionary (groceries, restaurants, etc): ${Math.round(discretionarySpending)} euros
- Daily discretionary burn rate: ${dailyDiscretionary} euros/day
- Unpaid bills still due this month: ${Math.round(unpaidBillsAmount)} euros
- Projected remaining expenses (bills + discretionary): ${projectedRemainingExpenses} euros
- Projected TOTAL month expenses: ${projectedTotalExpenses} euros
- Monthly debt payments: ${totalDebtPayments} euros
- Monthly investment contributions: ${totalInvestmentContributions} euros${savingGoal > 0 ? `\n- Savings goal: ${savingGoal} euros/month` : ""}
- ** PROJECTED MONTH-END BALANCE: ${projectedMonthEnd} euros ** (USE THIS NUMBER, do not calculate your own)
- Monthly surplus/deficit: ${totalExpectedMonthlyIncome - projectedTotalExpenses} euros (income minus projected expenses)
- Daily budget (rolling 14-day window: current balance minus must-pay obligations and savings, no future income counted): ${dailyBudget} euros/day
- Spending by category: ${categoryBreakdown}
- Top individual expenses: ${topExpenses}
- Bills this month: ${recurringBills.length > 0 ? recurringBills.map((b) => {
      const isPaid = matchedBillIds.has(b.id);
      const isOverdue = !isPaid && b.due_day < now.getDate();
      return `${b.name}: ${b.amount} euros (due ${b.due_day}th${isPaid ? " - PAID" : isOverdue ? " - OVERDUE" : " - upcoming"})`;
    }).join(", ") : "none configured"}
- Upcoming next month obligations (before next income): ${(() => {
      const nextIncDay = incomeSources.length > 0 ? Math.min(...incomeSources.map((i) => i.expected_day || 31)) : 31;
      const nextBills = recurringBills.filter((b) => b.due_day <= nextIncDay);
      const nextDebts = debtAccounts.filter((d) => d.dueDay <= nextIncDay && d.payment > 0);
      const items = [...nextBills.map((b) => `${b.name}: ${b.amount} euros (day ${b.due_day})`), ...nextDebts.map((d) => `${d.name}: ${d.payment} euros (day ${d.dueDay})`)];
      return items.length > 0 ? items.join(", ") + ` — total ${Math.round(nextBills.reduce((s, b) => s + b.amount, 0) + nextDebts.reduce((s, d) => s + d.payment, 0))} euros before next income on day ${nextIncDay}` : "none";
    })()}
- Total monthly bills: ${recurringBills.reduce((s, b) => s + b.amount, 0)} euros
- Income sources: ${incomeList}
- Debts: ${debtAccounts.length > 0 ? debtAccounts.map((d) => `${d.name}: ${d.balance} euros${d.rate > 0 ? ` (${d.rate}% APR)` : ""}${d.payment > 0 ? `, ${d.payment} euros/month` : ""}${d.dueDay > 0 ? ` (due ${d.dueDay}th)` : ""}`).join(", ") : "none"}
- Total debt: ${debtAccounts.reduce((s: number, d: { balance: number }) => s + d.balance, 0)} euros
- Investments: ${investmentAccounts.length > 0 ? investmentAccounts.map((i) => `${i.name}: ${i.balance} euros${i.monthly > 0 ? `, ${i.monthly} euros/month` : ""}${i.returnPct > 0 ? ` (${i.returnPct}% return)` : ""}`).join(", ") : "none"}
- Total investment value: ${investmentAccounts.reduce((s: number, i: { balance: number }) => s + i.balance, 0)} euros
- Monthly investment contributions: ${investmentAccounts.reduce((s: number, i: { monthly: number }) => s + i.monthly, 0)} euros
- Previous months: ${historySnapshots.length > 0 ? historySnapshots.map((s) => `${s.month}: income ${Math.round(s.income)} euros, expenses ${Math.round(s.expenses)} euros, net ${Math.round(s.income - s.expenses)} euros`).join("; ") : "no historical data yet"}
${(() => { const goals = db.prepare("SELECT name, target_amount, saved_amount, target_date FROM savings_goals WHERE is_active = 1").all() as { name: string; target_amount: number; saved_amount: number; target_date: string | null }[]; return goals.length > 0 ? `- Savings goals: ${goals.map((g) => `${g.name}: ${g.saved_amount}/${g.target_amount} euros${g.target_date ? ` by ${g.target_date}` : ""}`).join(", ")}` : ""; })()}`;

    const claudePath = process.env.CLAUDE_PATH || "claude";
    console.info("[summary] Calling claude CLI");

    const summaryText = await new Promise<string>((resolve, reject) => {
      const proc = spawn(claudePath, ["-p", "--model", "opus", "-"], {
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli" },
        timeout: 120000,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      proc.on("close", (code: number) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
        }
      });

      proc.on("error", reject);

      proc.stdin.write(prompt);
      proc.stdin.end();
    });

    let newId: number | undefined;
    if (summaryText) {
      const result = db.prepare("INSERT INTO ai_summaries (user_id, locale, content) VALUES (?, ?, ?)")
        .run(user.id, requestLocale, summaryText);
      newId = Number(result.lastInsertRowid);
      console.info("[summary] Summary generated and cached, length:", summaryText.length, "id:", newId);
    }

    return NextResponse.json({ id: newId, summary: summaryText, cached: false, created_at: new Date().toISOString() });
  } catch (error) {
    console.error("[summary] Error:", error);
    return NextResponse.json({ summary: null, error: "Failed to generate summary" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { id, is_hidden } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const db = getDb();
    db.prepare("UPDATE ai_summaries SET is_hidden = ? WHERE id = ?").run(is_hidden ? 1 : 0, id);
    console.info("[summary] Set is_hidden=", is_hidden ? 1 : 0, "on summary id", id, "by user", user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[summary] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update summary" }, { status: 500 });
  }
}
