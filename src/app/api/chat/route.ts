/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getFinancialAdvice } from "@/lib/ai/finance-advisor";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getYnabToken, getYnabBudgetId } from "@/lib/household";
import { eventBus } from "@/lib/event-bus";

export async function POST(request: Request) {
  try {
    const { messages, image, image_media_type, add_expense } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    // Get real YNAB data
    const user = await getSession();
    let context;

    if (user) {
      const token = getYnabToken();
      const budgetId = getYnabBudgetId();
      const locale = user.locale || "en";
      const { getHouseholdSetting } = await import("@/lib/household");
      const householdProfile = getHouseholdSetting("household_profile") || "";

      if (token && budgetId) {
        console.info("[chat] Loading YNAB data from cache");
        try {
          const now = new Date();

          // Use cached data instead of calling YNAB API directly
          const cached = getDb().prepare("SELECT data FROM ynab_cache WHERE id = 1").get() as { data: string; synced_at: string } | undefined;
          if (!cached) throw new Error("No cached YNAB data");
          const ynabData = JSON.parse(cached.data);
          const { summary, transactions, monthBudget } = ynabData;

          // Trigger background sync if cache is older than 2 hours
          const cacheAge = Date.now() - new Date(cached.synced_at).getTime();
          if (cacheAge > 2 * 60 * 60 * 1000) {
            console.info("[chat] YNAB cache is", Math.round(cacheAge / 60000), "min old, triggering background sync");
            fetch(new URL("/api/ynab/sync", request.url).toString(), {
              method: "POST",
              headers: { cookie: request.headers.get("cookie") || "" },
            }).catch((err) => console.warn("[chat] Background sync trigger failed:", err));
          }

          // Load excluded accounts for budget calculation
          const excludedRaw = getHouseholdSetting("budget_excluded_accounts");
          const excludedIds: string[] = excludedRaw ? JSON.parse(excludedRaw) : [];

          // Use local ynab_accounts for freshest balances
          const localAccounts = getDb().prepare(
            "SELECT id, name, type, balance FROM ynab_accounts WHERE closed = 0"
          ).all() as { id: string; name: string; type: string; balance: number }[];
          const accountSource = localAccounts.length > 0 ? localAccounts : summary.accounts;

          const checkingSavings = accountSource
            .filter((a: any) => (a.type === "checking" || a.type === "savings") && !excludedIds.includes(a.id))
            .reduce((s: number, a: any) => s + a.balance, 0);

          // Load account notes for AI context
          const accountNotesRows = getDb()
            .prepare("SELECT ynab_account_id, note FROM account_notes WHERE note != ''")
            .all() as { ynab_account_id: string; note: string }[];
          const accountNotesMap: Record<string, string> = {};
          for (const r of accountNotesRows) accountNotesMap[r.ynab_account_id] = r.note;

          const accountsWithNotes = accountSource
            .filter((a: any) => a.type === "checking" || a.type === "savings" || a.type === "otherAsset")
            .map((a: any) => ({
              name: a.name,
              balance: a.balance,
              type: a.type,
              note: accountNotesMap[a.id] || "",
              excludedFromBudget: excludedIds.includes(a.id),
            }));

          const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
          const daysLeft = daysInMonth - now.getDate();

          // Get debts from accounts with overrides
          const chatDb = getDb();
          const debtOverrides = chatDb.prepare("SELECT * FROM debt_overrides").all() as any[];
          const debtOverrideMap: Record<string, any> = {};
          for (const o of debtOverrides) debtOverrideMap[o.ynab_account_id] = o;

          const debts = summary.accounts
            .filter((a: any) => a.type === "otherDebt" && a.balance < 0)
            .map((a: any) => {
              const override = debtOverrideMap[a.id];
              return { name: a.name, remaining: Math.abs(a.balance), rate: override?.interest_rate ?? 0, minimumPayment: override?.minimum_payment ?? 0, dueDay: override?.due_day ?? 0, isPriority: !!override?.is_priority };
            });

          // Get investment accounts with overrides
          const investOverrides = chatDb.prepare("SELECT * FROM investment_overrides").all() as any[];
          const investOverrideMap: Record<string, any> = {};
          for (const o of investOverrides) investOverrideMap[o.ynab_account_id] = o;

          const investmentAccounts = summary.accounts
            .filter((a: any) => a.type === "otherAsset")
            .map((a: any) => {
              const override = investOverrideMap[a.id];
              return { name: a.name, balance: a.balance, monthlyContribution: override?.monthly_contribution ?? 0, expectedReturn: override?.expected_return ?? 7 };
            });

          // Get savings goal
          const savingRate = parseFloat(getHouseholdSetting("saving_rate") || "0");

          // Filter transfers
          const realIncomeTx = transactions.filter((t: any) => t.amount > 0 && !t.payee.startsWith("Transfer") && !t.payee.startsWith("Starting Balance") && !t.payee.startsWith("Reconciliation"));
          const realExpenseTx = transactions.filter((t: any) => t.amount < 0 && !t.payee.startsWith("Transfer") && !t.payee.startsWith("Starting Balance") && !t.payee.startsWith("Reconciliation") && t.category !== "Uncategorized");

          // Use local transactions table for recent transactions — always fresh
          const recentTx = chatDb.prepare(
            "SELECT t.date, t.payee, t.amount, t.category, u.display_name as spender FROM transactions t LEFT JOIN users u ON t.user_id = u.id WHERE t.payee NOT LIKE 'Transfer%' AND t.payee NOT LIKE 'Starting Balance%' AND t.payee NOT LIKE 'Reconciliation%' GROUP BY t.ynab_id ORDER BY t.date DESC LIMIT 10"
          ).all() as { date: string; payee: string; amount: number; category: string; spender: string | null }[];

          // Load recurring bills with paid/overdue status
          const bills = chatDb
            .prepare("SELECT id, name, amount, due_day, is_priority FROM recurring_bills WHERE is_active = 1 ORDER BY due_day ASC")
            .all() as { id: number; name: string; amount: number; due_day: number; is_priority: number }[];

          const chatMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          const chatBillMatches = chatDb
            .prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'bill' AND month = ?")
            .all(chatMonth) as { source_id: number }[];
          const paidBillIds = new Set(chatBillMatches.map((m) => m.source_id));

          // Manual overrides take priority over auto-match
          const manualStatuses = chatDb
            .prepare("SELECT bill_id, is_paid FROM bill_manual_status WHERE month = ?")
            .all(chatMonth) as { bill_id: number; is_paid: number }[];
          const manualMap = new Map(manualStatuses.map((m) => [m.bill_id, !!m.is_paid]));

          const enrichedBills: { name: string; amount: number; dueDay: number; status: string; type: string; isPriority: boolean }[] = bills.map((b) => {
            const isPaid = manualMap.has(b.id) ? manualMap.get(b.id)! : paidBillIds.has(b.id);
            return {
            name: b.name,
            amount: b.amount,
            dueDay: b.due_day,
            status: isPaid ? "paid" : b.due_day < now.getDate() ? "overdue" : "upcoming",
            type: "bill",
            isPriority: !!b.is_priority,
          }; });

          // Load subscriptions with paid status from payee matching
          const subscriptions = chatDb
            .prepare("SELECT id, name, amount, due_day, is_priority FROM subscriptions WHERE is_active = 1 ORDER BY due_day ASC")
            .all() as { id: number; name: string; amount: number; due_day: number; is_priority: number }[];
          const subMatches = chatDb
            .prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'subscription' AND month = ?")
            .all(chatMonth) as { source_id: number }[];
          const paidSubIds = new Set(subMatches.map((m) => m.source_id));

          // Merge subscriptions into bills for calculations
          for (const sub of subscriptions) {
            enrichedBills.push({
              name: sub.name,
              amount: sub.amount,
              dueDay: sub.due_day,
              status: paidSubIds.has(sub.id) ? "paid" : sub.due_day < now.getDate() ? "overdue" : "upcoming",
              type: "subscription",
              isPriority: !!sub.is_priority,
            });
          }

          // Load income sources from DB
          const incomeRows = chatDb
            .prepare("SELECT name, amount, expected_day FROM income_sources WHERE is_active = 1 ORDER BY expected_day ASC")
            .all() as { name: string; amount: number; expected_day: number }[];

          // Load savings goals
          const savingsGoals = chatDb
            .prepare("SELECT name, target_amount, saved_amount, target_date FROM savings_goals WHERE is_active = 1 ORDER BY name ASC")
            .all() as { name: string; target_amount: number; saved_amount: number; target_date: string | null }[];

          // Load monthly history for comparisons
          const chatHistoryMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          const historySnapshots = chatDb
            .prepare("SELECT month, income, expenses FROM monthly_snapshots WHERE month < ? ORDER BY month DESC LIMIT 3")
            .all(chatHistoryMonth) as { month: string; income: number; expenses: number }[];

          // Pre-calculate time-sequenced cash flow for AI
          const today = now.getDate();
          const unpaidBills = enrichedBills.filter((b) => b.status !== "paid");
          const unpaidBillsTotal = unpaidBills.reduce((s, b) => s + b.amount, 0);
          const debtPaymentsTotal = debts.reduce((s: number, d: any) => s + (d.minimumPayment || 0), 0);
          const investmentContributions = investmentAccounts.reduce((s: number, i: any) => s + (i.monthlyContribution || 0), 0);

          // Load income matches and sources for daily budget simulation.
          // Manual received/not-received overrides win over auto-match.
          const chatIncomeMatches = chatDb
            .prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'income' AND month = ?")
            .all(chatMonth) as { source_id: number }[];
          const chatManualIncome = chatDb
            .prepare("SELECT income_id, is_received FROM income_manual_status WHERE month = ?")
            .all(chatMonth) as { income_id: number; is_received: number }[];
          const chatManualMap = new Map(chatManualIncome.map((m) => [m.income_id, !!m.is_received]));
          const autoIncomeIds = new Set(chatIncomeMatches.map((m) => m.source_id));
          const matchedIncomeIds = new Set<number>();
          for (const id of new Set<number>([...autoIncomeIds, ...chatManualMap.keys()])) {
            const received = chatManualMap.has(id) ? chatManualMap.get(id)! : autoIncomeIds.has(id);
            if (received) matchedIncomeIds.add(id);
          }

          const incomeWithIds = chatDb
            .prepare("SELECT id, name, amount, expected_day FROM income_sources WHERE is_active = 1 ORDER BY expected_day ASC")
            .all() as { id: number; name: string; amount: number; expected_day: number }[];

          const resolveDay = (day: number) => day === 0 ? daysInMonth : day;

          // Daily budget via shared cash flow simulation — respect bills setting
          const { calculateDailyBudget } = await import("@/lib/daily-budget");
          const billsSetting = getHouseholdSetting("budget_include_bills") || "auto";
          const reserveSetting = getHouseholdSetting("reserve_next_month_saving") === "1";
          const lastReservationMonth = getHouseholdSetting("last_reservation_month") || "";
          const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          const nextYM = (() => {
            const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          })();
          const largestInc = [...incomeWithIds].sort((a, b) => b.amount - a.amount)[0];
          const largestDay = largestInc ? Math.min(resolveDay(largestInc.expected_day), daysInMonth) : 0;
          const reserveActive = reserveSetting && largestDay >= daysInMonth - 2 && today >= largestDay && lastReservationMonth !== nextYM;
          const allDebtItems = debts.map((d: any) => ({ amount: d.minimumPayment || 0, dueDay: d.dueDay || 0 }));
          const budgetParams = {
            balance: checkingSavings,
            savingGoal: savingRate,
            today,
            daysInMonth,
            extraSavingReserve: reserveActive ? savingRate : 0,
            skipCurrentMonthSaving: lastReservationMonth === currentYM,
            unpaidBills: unpaidBills.map((b) => ({ amount: b.amount, dueDay: b.dueDay })),
            debts: allDebtItems,
            unreceivedIncomes: incomeWithIds
              .filter((i) => resolveDay(i.expected_day) > today && !matchedIncomeIds.has(i.id))
              .map((i) => ({ amount: i.amount, expectedDay: i.expected_day })),
            allIncomes: incomeWithIds.map((i) => ({ amount: i.amount, expectedDay: i.expected_day })),
            allBills: enrichedBills.map((b) => ({ amount: b.amount, dueDay: b.dueDay })),
            allDebts: allDebtItems,
            resolveDay,
          };

          // Apply bills setting: auto, always, or never. Priority items always reserved.
          const priorityBills = unpaidBills.filter((b: any) => b.isPriority).map((b: any) => ({ amount: b.amount, dueDay: b.dueDay }));
          const priorityDebts = allDebtItems.filter((_: unknown, i: number) => debts[i]?.isPriority);
          const allPriorityBills = enrichedBills.filter((b: any) => b.isPriority).map((b: any) => ({ amount: b.amount, dueDay: b.dueDay }));
          const budgetWithBills = calculateDailyBudget(budgetParams);
          const budgetWithoutBills = calculateDailyBudget({ ...budgetParams, unpaidBills: priorityBills, debts: priorityDebts, allBills: allPriorityBills, allDebts: priorityDebts });
          let dailyBudget: number;
          if (billsSetting === "auto") {
            const totalUnpaid = budgetParams.unpaidBills.reduce((s: number, b: { amount: number }) => s + b.amount, 0) + budgetParams.debts.reduce((s: number, d: { amount: number }) => s + d.amount, 0);
            const thresholdNormal = parseInt(getHouseholdSetting("budget_threshold_normal") || "30", 10);
            const canAfford = checkingSavings > totalUnpaid && budgetWithBills.dailyBudget >= thresholdNormal;
            dailyBudget = canAfford ? budgetWithBills.dailyBudget : budgetWithoutBills.dailyBudget;
          } else if (billsSetting === "1") {
            dailyBudget = budgetWithBills.dailyBudget;
          } else {
            dailyBudget = budgetWithoutBills.dailyBudget;
          }

          // Build segment summary for AI context
          const segmentSummary = incomeWithIds
            .filter((i) => resolveDay(i.expected_day) > today && !matchedIncomeIds.has(i.id))
            .sort((a, b) => resolveDay(a.expected_day) - resolveDay(b.expected_day))
            .map((i) => `Day ${resolveDay(i.expected_day)}: ${i.name} ${i.amount} euros arrives`)
            .join(", ");

          const incomeBeforePayday = incomeWithIds
            .filter((i) => i.expected_day >= today && i.expected_day < daysInMonth && !matchedIncomeIds.has(i.id))
            .reduce((s, i) => s + i.amount, 0);

          // Available before payday = current balance + small incomes before payday - bills - debts
          const availableBeforePayday = Math.round((checkingSavings + incomeBeforePayday - unpaidBillsTotal - debtPaymentsTotal) * 100) / 100;
          const daysBeforePayday = daysInMonth - today;
          const dailySpendableBeforePayday = daysBeforePayday > 0 ? Math.round((Math.max(0, availableBeforePayday) / daysBeforePayday) * 100) / 100 : 0;

          const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          // Exclude fixed costs (bills, debts, investments) from today's discretionary spending
          const billNameSet = new Set([...bills.map((b) => b.name.toLowerCase()), ...subscriptions.map((s) => s.name.toLowerCase())]);
          const debtNames: string[] = debts.map((d: { name: string }) => d.name.toLowerCase());
          const debtNameSet = new Set(debtNames);
          const todayTxRows = chatDb.prepare(
            "SELECT amount, payee, category FROM transactions WHERE date = ? AND amount < 0 AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting Balance%' GROUP BY ynab_id"
          ).all(todayStr) as { amount: number; payee: string; category: string }[];
          const isFixedCost = (p: string, c: string) => {
            const pl = p.toLowerCase(); const cl = c.toLowerCase();
            if ([...billNameSet].some((bn) => pl.includes(bn) || bn.includes(pl) || cl.includes(bn) || bn.includes(cl))) return true;
            if ([...debtNameSet].some((dn) => pl.includes(dn) || dn.includes(pl) || cl.includes(dn) || dn.includes(cl))) return true;
            if (cl.includes("sijoittaminen") || cl.includes("investing") || cl.includes("investment")) return true;
            return false;
          };
          const todaySpent = Math.round(todayTxRows.filter((t) => !isFixedCost(t.payee, t.category)).reduce((s, t) => s + Math.abs(t.amount), 0) * 100) / 100;
          const todayFixedCosts = Math.round(todayTxRows.filter((t) => isFixedCost(t.payee, t.category)).reduce((s, t) => s + Math.abs(t.amount), 0) * 100) / 100;

          // Monthly expenses from local DB for freshness
          const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
          const localMonthlyExpenses = Math.round(
            (chatDb.prepare(
              "SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM (SELECT amount FROM transactions WHERE date >= ? AND amount < 0 AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting Balance%' AND payee NOT LIKE 'Reconciliation%' AND category != 'Uncategorized' GROUP BY ynab_id)"
            ).get(monthStart) as { total: number }).total * 100
          ) / 100;
          const daysToNextIncome = (() => {
            const unreceived = incomeWithIds
              .filter((i) => resolveDay(i.expected_day) > today && !matchedIncomeIds.has(i.id))
              .sort((a, b) => resolveDay(a.expected_day) - resolveDay(b.expected_day));
            if (unreceived.length > 0) return resolveDay(unreceived[0].expected_day) - today;
            const allDays = incomeWithIds.map((i) => resolveDay(i.expected_day)).sort((a, b) => a - b);
            return allDays.length > 0 ? (daysInMonth - today) + allDays[0] : Math.max(1, daysLeft);
          })();
          // Tomorrow's budget: re-run the engine as of tomorrow on the money
          // actually left. Today's spend already reduced the balance; no spreading.
          const tomorrowParams = { ...budgetParams, today: today + 1 };
          const tomorrowWithBills = calculateDailyBudget(tomorrowParams);
          const tomorrowWithoutBills = calculateDailyBudget({ ...tomorrowParams, unpaidBills: priorityBills, debts: priorityDebts, allBills: allPriorityBills, allDebts: priorityDebts });
          let tomorrowBudget: number;
          if (billsSetting === "auto") {
            const totalUnpaidT = budgetParams.unpaidBills.reduce((s: number, b: { amount: number }) => s + b.amount, 0) + budgetParams.debts.reduce((s: number, d: { amount: number }) => s + d.amount, 0);
            const thresholdNormalT = parseInt(getHouseholdSetting("budget_threshold_normal") || "30", 10);
            tomorrowBudget = (checkingSavings > totalUnpaidT && tomorrowWithBills.dailyBudget >= thresholdNormalT) ? tomorrowWithBills.dailyBudget : tomorrowWithoutBills.dailyBudget;
          } else if (billsSetting === "1") {
            tomorrowBudget = tomorrowWithBills.dailyBudget;
          } else {
            tomorrowBudget = tomorrowWithoutBills.dailyBudget;
          }

          context = {
            totalBalance: Math.round(checkingSavings * 100) / 100,
            monthlyIncome: Math.round(monthBudget.income * 100) / 100,
            monthlyExpenses: localMonthlyExpenses,
            todaySpent,
            todayFixedCosts,
            tomorrowBudget,
            upcomingBills: enrichedBills,
            recentTransactions: recentTx,
            debts,
            investments: investmentAccounts,
            savingGoal: savingRate,
            incomeSources: incomeRows.map((i) => ({ name: i.name, amount: i.amount, expectedDay: i.expected_day })),
            dailyBudget,
            daysUntilNextIncome: (() => {
              const unreceived = incomeWithIds
                .filter((i) => resolveDay(i.expected_day) > today && !matchedIncomeIds.has(i.id))
                .sort((a, b) => resolveDay(a.expected_day) - resolveDay(b.expected_day));
              if (unreceived.length > 0) return resolveDay(unreceived[0].expected_day) - today;
              const allDays = incomeWithIds.map((i) => resolveDay(i.expected_day)).sort((a, b) => a - b);
              return allDays.length > 0 ? (daysInMonth - today) + allDays[0] : daysLeft;
            })(),
            availableBeforePayday,
            dailySpendableBeforePayday,
            monthlyHistory: historySnapshots.map((s) => ({ month: s.month, income: Math.round(s.income), expenses: Math.round(s.expenses), net: Math.round(s.income - s.expenses) })),
            savingsGoals: savingsGoals.map((g) => ({ name: g.name, target: g.target_amount, saved: g.saved_amount, targetDate: g.target_date })),
            accounts: accountsWithNotes,
            locale,
            householdProfile,
            currentUser: user.display_name || user.email,
          };

          console.info("[chat] Context built with real data, balance:", context.totalBalance);
        } catch (err) {
          console.error("[chat] Failed to fetch YNAB data:", err);
        }
      }
    }

    // Fallback: assemble context from local data when YNAB is not connected
    if (!context) {
      console.info("[chat] Building local financial context (no YNAB)");
      const { buildLocalFinancialData } = await import("@/lib/local-financial-data");
      const { getHouseholdSetting: getHS } = await import("@/lib/household");
      const dbc = getDb();
      const local = buildLocalFinancialData(dbc);
      const dOv = dbc.prepare("SELECT * FROM debt_overrides").all() as any[];
      const dOvMap: Record<string, any> = {};
      for (const o of dOv) dOvMap[o.ynab_account_id] = o;
      const iOv = dbc.prepare("SELECT * FROM investment_overrides").all() as any[];
      const iOvMap: Record<string, any> = {};
      for (const o of iOv) iOvMap[o.ynab_account_id] = o;
      const debts = local.summary.accounts
        .filter((a: any) => a.type === "otherDebt" && a.balance < 0)
        .map((a: any) => ({ name: a.name, remaining: Math.abs(a.balance), rate: dOvMap[a.id]?.interest_rate ?? 0, minimumPayment: dOvMap[a.id]?.minimum_payment ?? 0, dueDay: dOvMap[a.id]?.due_day ?? 0 }));
      const investments = local.summary.accounts
        .filter((a: any) => a.type === "otherAsset")
        .map((a: any) => ({ name: a.name, balance: a.balance, monthlyContribution: iOvMap[a.id]?.monthly_contribution ?? 0, expectedReturn: iOvMap[a.id]?.expected_return ?? 0 }));
      const incomeSources = (dbc.prepare("SELECT name, amount, expected_day FROM income_sources WHERE is_active = 1").all() as any[])
        .map((s: any) => ({ name: s.name, amount: s.amount, expectedDay: s.expected_day }));
      context = {
        totalBalance: local.summary.totalBalance,
        monthlyIncome: local.monthBudget.income,
        monthlyExpenses: local.monthBudget.activity,
        todaySpent: 0,
        todayFixedCosts: 0,
        tomorrowBudget: 0,
        upcomingBills: [],
        recentTransactions: local.transactions.slice(0, 30).map((t: any) => ({ date: t.date, payee: t.payee, amount: t.amount, category: t.category })),
        debts,
        investments,
        savingGoal: 0,
        incomeSources,
        dailyBudget: 0,
        daysUntilNextIncome: 0,
        availableBeforePayday: 0,
        dailySpendableBeforePayday: 0,
        monthlyHistory: [],
        savingsGoals: [],
        accounts: local.summary.accounts.map((a: any) => ({ name: a.name, balance: a.balance, type: a.type, note: "" })),
        locale: user?.locale || "en",
        householdProfile: getHS("household_profile") || "",
        currentUser: user?.display_name || "unknown",
      };
    }

    // Auto-add expense(s) if image attached, BEFORE calling AI so it knows
    let expenseContext = "";
    if (image && image_media_type && add_expense && user) {
      try {
        console.info("[chat] Attempting to auto-add expenses from image");
        const { queryClaudeWithImage } = await import("@/lib/ai/claude-image");
        const chatToday = new Date().toISOString().slice(0, 10);
        const chatYesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        // Load YNAB account names for smart account detection
        const expAccounts = getDb().prepare("SELECT name FROM ynab_accounts WHERE closed = 0").all() as { name: string }[];
        const accountNames = expAccounts.map((a) => a.name).join(", ");

        const parseResult = await queryClaudeWithImage(
          `Extract ALL transactions/expenses from this image. For each: amount (number only), payee/store name, date (YYYY-MM-DD), and account/card name if visible.
Today is ${chatToday}. "Tänään"/"Today" = ${chatToday}. "Eilen"/"Yesterday" = ${chatYesterday}. Convert dates like "19.3." to YYYY-MM-DD. Transactions under date headings inherit that date. If no date visible, use ${chatToday}.
For "account": look for card brand, bank name, or app name (Revolut, Visa, Mastercard, S-Pankki, Nordea, OP, etc). Match to one of these YNAB accounts if possible: ${accountNames}. Use the exact YNAB account name. If unclear, leave empty.
If single receipt, return one item. If bank statement or multiple items, return ALL.
Reply with ONLY a valid JSON array: [{"amount":"...","payee":"...","date":"YYYY-MM-DD","account":"..."}]`,
          image,
          image_media_type,
          30000
        );

        let transactions: { amount: string; payee: string; date?: string; account?: string }[] = [];
        try {
          const arrayMatch = parseResult.text.match(/\[[\s\S]*\]/);
          if (arrayMatch) {
            transactions = JSON.parse(arrayMatch[0]);
          } else {
            const objMatch = parseResult.text.match(/\{[\s\S]*\}/);
            if (objMatch) transactions = [JSON.parse(objMatch[0])];
          }
        } catch {
          console.warn("[chat] Failed to parse receipt JSON:", parseResult.text);
        }

        if (transactions.length > 0) {
          // Default account: user's linked account
          const defaultAcc = getDb()
            .prepare("SELECT ynab_account_id FROM user_linked_accounts WHERE user_id = ? LIMIT 1")
            .get(user.id) as { ynab_account_id: string } | undefined;

          // Load all YNAB accounts for name-based routing
          const ynabCache = getDb().prepare("SELECT data FROM ynab_cache WHERE id = 1").get() as { data: string } | undefined;
          const allYnabAccounts = ynabCache
            ? JSON.parse(ynabCache.data).summary.accounts.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }))
            : [];

          if (defaultAcc) {
            const added: string[] = [];
            const failed: string[] = [];

            for (const tx of transactions) {
              if (!tx.amount || !tx.payee) continue;

              // Resolve account: if receipt shows an account name, match it to YNAB accounts
              let accountId = defaultAcc.ynab_account_id;
              if (tx.account) {
                const matched = allYnabAccounts.find((a: { id: string; name: string }) => a.name === tx.account);
                if (matched) {
                  accountId = matched.id;
                  console.info("[chat] Routed to account:", matched.name, "from receipt:", tx.account);
                }
              }

              try {
                const txRes = await fetch(new URL("/api/ynab/transaction", request.url).toString(), {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    cookie: request.headers.get("cookie") || "",
                  },
                  body: JSON.stringify({
                    account_id: accountId,
                    amount: String(tx.amount).replace(",", "."),
                    payee_name: tx.payee,
                    date: tx.date || chatToday,
                  }),
                });
                if (txRes.ok) {
                  added.push(`${tx.amount} euros from ${tx.payee}`);
                  console.info("[chat] Auto-added expense:", tx.payee, tx.amount);
                } else {
                  failed.push(`${tx.payee} (${tx.amount})`);
                }
              } catch {
                failed.push(`${tx.payee} (${tx.amount})`);
              }
            }

            if (added.length > 0) {
              expenseContext = `SYSTEM NOTE: You successfully added ${added.length} expense(s) to YNAB: ${added.join("; ")}. Confirm this naturally in your response, listing what was added. Do NOT say you cannot add expenses.`;
              // Trigger background sync
              fetch(new URL("/api/ynab/sync", request.url).toString(), {
                method: "POST",
                headers: { cookie: request.headers.get("cookie") || "" },
              }).catch((err) => console.warn("[chat] Background sync after expense failed:", err));
            }
            if (failed.length > 0) {
              expenseContext += ` Failed to add: ${failed.join("; ")}.`;
            }
          }
        }
      } catch (err) {
        console.warn("[chat] Auto-add expense failed:", err);
      }
    }

    // Append expense context to the last user message so AI knows what happened
    const messagesWithContext = [...messages];
    if (expenseContext && messagesWithContext.length > 0) {
      const last = messagesWithContext[messagesWithContext.length - 1];
      if (last.role === "user") {
        messagesWithContext[messagesWithContext.length - 1] = {
          ...last,
          content: last.content + "\n\n" + expenseContext,
        };
      }
    }

    // Load recent reactions so Dougie knows what users liked/disliked
    if (user) {
      try {
        const reactionRows = getDb().prepare(`
          SELECT cm.content AS msg_preview, r.emoji, u.display_name AS reactor
          FROM chat_reactions r
          JOIN chat_messages cm ON cm.id = r.message_id
          JOIN users u ON u.id = r.user_id
          WHERE cm.role = 'assistant'
          ORDER BY r.created_at DESC LIMIT 10
        `).all() as { msg_preview: string; emoji: string; reactor: string }[];

        if (reactionRows.length > 0) {
          const reactionSummary = reactionRows.map((r) =>
            `${r.reactor} reacted ${r.emoji} to "${r.msg_preview.slice(0, 50)}..."`
          ).join("\n");
          const last = messagesWithContext[messagesWithContext.length - 1];
          if (last?.role === "user") {
            messagesWithContext[messagesWithContext.length - 1] = {
              ...last,
              content: last.content + `\n\n[SYSTEM: Recent reactions from users on your messages:\n${reactionSummary}]`,
            };
          }
        }
      } catch (err) {
        console.warn("[chat] Failed to load reactions context:", err);
      }
    }

    const fullResponse = await getFinancialAdvice(messagesWithContext, context, image, image_media_type);

    // Save assistant response to DB for persistence
    if (user && fullResponse) {
      try {
        const chatDb = getDb();
        chatDb.prepare("INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)")
          .run(user.id, "assistant", fullResponse);
        console.info("[chat] Saved assistant response to DB");
        const lastId = chatDb.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
        eventBus.emit("chat:message", {
          id: lastId.id,
          role: "assistant",
          content: fullResponse,
          sender: null,
          userId: null,
        });
      } catch (err) {
        console.error("[chat] Failed to save response to DB:", err);
      }
    }

    return NextResponse.json({ message: fullResponse });
  } catch (error) {
    console.error("[chat] API error:", error);
    return NextResponse.json(
      { message: "Sorry, something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
