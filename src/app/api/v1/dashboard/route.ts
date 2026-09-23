import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { getHouseholdSettings } from "@/lib/household";
import { NOT_BUDGET_EXCLUDED, cashFlowHistory } from "@/lib/budget-math";
import { buildLocalFinancialData } from "@/lib/local-financial-data";
import { buildDashboard, type DashBill, type DashDebt, type DashIncome } from "@/lib/dashboard-model";
import { monthCommitments } from "@/lib/commitments";
import { localDateIso } from "@/lib/date-utils";

// GET /api/v1/dashboard - everything the dashboard shows, in one call: the daily budget and why it
// is what it is, today's spending, the obligations ahead, the charts and the month's figures. The
// numbers are produced by lib/dashboard-model, the same module the web dashboard reads, so a phone
// and a browser looking at the same instance cannot disagree.
export const GET = apiRoute("read", (_request, identity) => {
  const db = getDb();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const settings = getHouseholdSettings();

  const data = buildLocalFinancialData(db);

  const parseJsonSetting = (key: string): string[] => {
    try {
      return settings[key] ? JSON.parse(settings[key]) : [];
    } catch {
      console.warn("[v1/dashboard]", key, "is not valid JSON, treating as empty");
      return [];
    }
  };

  // Bills and subscriptions are one list here, exactly as the dashboard treats them: both are money
  // that leaves on a known day. Subscription ids are offset so the two id spaces cannot collide.
  const billRows = db
    .prepare(
      "SELECT id, name, amount, due_day, is_active, COALESCE(is_priority, 0) AS is_priority, " +
        "COALESCE(cadence, 'monthly') AS cadence, due_month, COALESCE(interval_months, 1) AS interval_months " +
        "FROM recurring_bills ORDER BY due_day ASC"
    )
    .all() as {
      id: number; name: string; amount: number; due_day: number; is_active: number;
      is_priority: number; cadence: string; due_month: number | null; interval_months: number;
    }[];
  const subscriptionRows = db
    .prepare("SELECT id, name, amount, due_day, is_active, COALESCE(is_priority, 0) AS is_priority FROM subscriptions ORDER BY due_day ASC")
    .all() as { id: number; name: string; amount: number; due_day: number; is_active: number; is_priority: number }[];

  const manualPaid = new Map(
    (db.prepare("SELECT bill_id, is_paid FROM bill_manual_status WHERE month = ?").all(month) as {
      bill_id: number; is_paid: number;
    }[]).map((r) => [r.bill_id, !!r.is_paid])
  );
  const matchedBills = new Set(
    (db.prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'bill' AND month = ?").all(month) as {
      source_id: number;
    }[]).map((r) => r.source_id)
  );
  const matchedSubscriptions = new Set(
    (db.prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'subscription' AND month = ?").all(month) as {
      source_id: number;
    }[]).map((r) => r.source_id)
  );

  const SUBSCRIPTION_ID_OFFSET = 10000;
  const bills: DashBill[] = [
    ...billRows.map((b) => ({
      id: b.id,
      name: b.name,
      amount: b.amount,
      due_day: b.due_day,
      is_active: !!b.is_active,
      is_paid: manualPaid.has(b.id) ? manualPaid.get(b.id)! : matchedBills.has(b.id),
      is_priority: !!b.is_priority,
      cadence: b.cadence,
      due_month: b.due_month,
      interval_months: b.interval_months,
    })),
    ...subscriptionRows.map((s) => {
      const id = s.id + SUBSCRIPTION_ID_OFFSET;
      return {
        id,
        name: s.name,
        amount: s.amount,
        due_day: s.due_day,
        is_active: !!s.is_active,
        is_paid: manualPaid.has(id) ? manualPaid.get(id)! : matchedSubscriptions.has(s.id),
        is_priority: !!s.is_priority,
        cadence: "monthly",
        due_month: null,
        interval_months: 1,
      };
    }),
  ];

  const incomeRows = db
    .prepare("SELECT id, name, amount, expected_day, is_active FROM income_sources ORDER BY expected_day ASC")
    .all() as { id: number; name: string; amount: number; expected_day: number; is_active: number }[];
  const manualReceived = new Map(
    (db.prepare("SELECT income_id, is_received FROM income_manual_status WHERE month = ?").all(month) as {
      income_id: number; is_received: number;
    }[]).map((r) => [r.income_id, !!r.is_received])
  );
  const matchedIncome = new Set(
    (db.prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'income' AND month = ?").all(month) as {
      source_id: number;
    }[]).map((r) => r.source_id)
  );
  const incomes: DashIncome[] = incomeRows.map((i) => ({
    id: i.id,
    name: i.name,
    amount: i.amount,
    expected_day: i.expected_day,
    is_active: !!i.is_active,
    received: manualReceived.has(i.id) ? manualReceived.get(i.id)! : matchedIncome.has(i.id),
  }));

  // Every figure the plan sets aside beyond the bills, read the same way the debts page reads it.
  const commitments = monthCommitments(db, month);
  const debts: DashDebt[] = commitments.debts.map((d) => ({
    name: d.name,
    amount: d.amount,
    dueDay: d.dueDay,
    isPriority: d.isPriority,
  }));

  // Straight from the ledger, not from monthly_snapshots: that table is written by a YNAB sync and
  // stops the day one stops, which left the cash flow chart skipping the months after it.
  const monthlyHistory = cashFlowHistory(db, 5, month);

  // This month against the same stretch of last month, so a comparison on the 3rd is not read as a
  // collapse in spending. Same query the trends route uses.
  const TREND_FILTER =
    "amount < 0 AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting Balance%' " +
    "AND payee NOT LIKE 'Reconciliation%' AND category != 'Uncategorized' " +
    "AND category != 'Inflow: Ready to Assign' AND category != '' AND " + NOT_BUDGET_EXCLUDED;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStart = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
  const lastMonthSameDay = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth(), now.getDate() + 1);
  const lastMonthSameDayStr = `${lastMonthSameDay.getFullYear()}-${String(lastMonthSameDay.getMonth() + 1).padStart(2, "0")}-${String(lastMonthSameDay.getDate()).padStart(2, "0")}`;

  const thisMonthByCategory = db
    .prepare(`SELECT category, SUM(ABS(amount)) AS total FROM transactions WHERE date >= ? AND ${TREND_FILTER} GROUP BY category`)
    .all(`${month}-01`) as { category: string; total: number }[];
  const lastMonthByCategory = db
    .prepare(`SELECT category, SUM(ABS(amount)) AS total FROM transactions WHERE date >= ? AND date < ? AND ${TREND_FILTER} GROUP BY category`)
    .all(lastMonthStart, lastMonthSameDayStr) as { category: string; total: number }[];

  const thisMonthMap = new Map(thisMonthByCategory.map((r) => [r.category, r.total]));
  const lastMonthMap = new Map(lastMonthByCategory.map((r) => [r.category, r.total]));
  const trends = [...new Set([...thisMonthMap.keys(), ...lastMonthMap.keys()])]
    .map((category) => ({
      category,
      thisMonth: thisMonthMap.get(category) || 0,
      lastMonth: lastMonthMap.get(category) || 0,
    }))
    .filter((t) => t.thisMonth > 0 || t.lastMonth > 0);

  // Whose spending counts as "yours" rather than the household's: the accounts this user has linked
  // and the share they have set. Without these the endpoint reported household spending as personal.
  const linkedAccountIds = (
    db.prepare("SELECT ynab_account_id FROM user_linked_accounts WHERE user_id = ?").all(identity.userId) as {
      ynab_account_id: string;
    }[]
  ).map((row) => row.ynab_account_id);
  const displayName =
    (db.prepare("SELECT COALESCE(display_name, '') AS name FROM users WHERE id = ?").get(identity.userId) as
      | { name: string }
      | undefined)?.name ?? "";
  const personalBudgetShare =
    (db.prepare("SELECT COALESCE(budget_share, 0) AS share FROM users WHERE id = ?").get(identity.userId) as
      | { share: number }
      | undefined)?.share ?? 0;

  // The daily budget each past day was actually given: the pace line is read against these.
  const budgetByDay: Record<number, number> = {};
  for (const row of db
    .prepare("SELECT date, budget FROM daily_budget_history WHERE date >= ? AND date <= ?")
    .all(`${month}-01`, `${month}-31`) as { date: string; budget: number }[]) {
    if (row.budget > 0) {
      budgetByDay[parseInt(row.date.slice(8, 10), 10)] = row.budget;
    }
  }

  // The month status this answers with is the same figure lib/month-status assembles for the web
  // page, from the same rows. Change one and change the other.
  const model = buildDashboard({
    now,
    displayName,
    accounts: data.summary.accounts,
    transactions: data.transactions,
    monthBudget: data.monthBudget,
    bills,
    incomes,
    debts,
    savingRate: parseFloat(settings.saving_rate || "0") || 0,
    debtMonthly: commitments.debtMonthly,
    investmentMonthly: commitments.investmentMonthly,
    commitmentCategories: commitments.categories,
    // The phone lists the categories rather than drawing six slices, so it takes ten.
    topCategories: 10,
    excludedAccountIds: parseJsonSetting("budget_excluded_accounts"),
    linkedAccountIds,
    personalBudgetShare,
    budgetIncludeBills:
      settings.budget_include_bills === undefined || settings.budget_include_bills === "auto"
        ? "auto"
        : settings.budget_include_bills === "1",
    thresholds: {
      tight: parseInt(settings.budget_threshold_tight || "20", 10),
      normal: parseInt(settings.budget_threshold_normal || "30", 10),
      good: parseInt(settings.budget_threshold_good || "50", 10),
    },
    reserveNextMonthSaving: settings.reserve_next_month_saving === "1",
    lastReservationMonth: settings.last_reservation_month || "",
    monthlyHistory: monthlyHistory.reverse(),
    trends,
    budgetByDay,
  });

  // Record today's figures as the web's savings streak does, so a day spent only in the app still
  // leaves the history the pace line reads. The web's own discretionary target is left as it is.
  db.prepare(
    "INSERT INTO daily_budget_history (date, budget, spent) VALUES (?, ?, ?) " +
      "ON CONFLICT(date) DO UPDATE SET budget = excluded.budget, spent = excluded.spent"
  ).run(localDateIso(), model.daily_budget.amount, model.today.spent);

  console.info("[v1/dashboard] Daily budget", model.daily_budget.amount, "for", model.month);
  return model;
});
