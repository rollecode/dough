import { calculateDailyBudget, type DailyBudgetResult } from "./daily-budget";
import { fixedCostMatcher } from "./fixed-costs";
import { spendingFlow } from "./spending-flow";
import { billDueInMonth } from "./bills";
import { isTransfer } from "./transaction-utils";
import { streakWeek, type StreakDay, type StreakRecord } from "./savings-streak";

// The dashboard's figures, in one place. The web page used to derive all of this in the browser,
// which left the API with no way to answer "what does the dashboard say" and no way for another
// client to agree with it. These are pure functions over already-loaded data, so the page and the
// /api/v1/dashboard route can both call them and cannot drift apart.

export interface DashAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
}

export interface DashTransaction {
  id: string;
  date: string;
  amount: number;
  payee: string;
  category: string;
  account_id?: string;
  excluded?: boolean;
}

export interface DashCategory {
  name: string;
  activity: number;
}

export interface DashBill {
  id: number;
  name: string;
  amount: number;
  due_day: number;
  is_active: boolean;
  is_paid: boolean;
  is_priority?: boolean;
  cadence?: string;
  due_month?: number | null;
  interval_months?: number;
}

export interface DashIncome {
  id: number;
  name: string;
  amount: number;
  expected_day: number;
  is_active: boolean;
  received: boolean;
}

export interface DashDebt {
  name: string;
  amount: number;
  dueDay: number;
  isPriority: boolean;
}

export interface DashThresholds {
  tight: number;
  normal: number;
  good: number;
}

export interface DashboardInput {
  now: Date;
  displayName: string;
  accounts: DashAccount[];
  transactions: DashTransaction[];
  monthBudget: {
    income: number;
    // What has actually landed this month, where `income` also counts what is still expected.
    received?: number;
    activity: number;
    toBeBudgeted: number;
    categories: DashCategory[];
  };
  bills: DashBill[];
  incomes: DashIncome[];
  debts: DashDebt[];
  savingRate: number;
  debtMonthly: number;
  investmentMonthly: number;
  commitmentCategories: string[];
  excludedAccountIds: string[];
  linkedAccountIds: string[];
  personalBudgetShare: number;
  budgetIncludeBills: boolean | "auto";
  thresholds: DashThresholds;
  reserveNextMonthSaving: boolean;
  lastReservationMonth: string;
  monthlyHistory: { month: string; income: number; expenses: number }[];
  trends: { category: string; thisMonth: number; lastMonth: number }[];
  // Day of month to the daily budget recorded on that day, from daily_budget_history.
  budgetByDay: Record<number, number>;
  // The last week of daily_budget_history rows, which the savings streak judges each day against.
  streakHistory: StreakRecord[];
  // How many of the month's biggest spending categories to report. Six fills the browser's donut;
  // a phone lists them, so it asks for more.
  topCategories?: number;
}

export interface DashboardModel {
  month: string;
  generated_at: string;
  currency: string;
  // Who is looking. The greeting says nothing at all without it, exactly as the web does.
  display_name: string;
  today: {
    day: number;
    spent: number;
    spent_personal: number;
    remaining: number;
    suggested_for_you: number;
  };
  daily_budget: {
    amount: number;
    tomorrow: number;
    with_bills: number;
    without_bills: number;
    bills_included: boolean;
    bills_delay_needed: boolean;
    thresholds: DashThresholds;
    breakdown: DailyBudgetResult["tightestSegment"];
    notice: {
      obligation_name: string;
      obligation_amount: number;
      saving_reserve: number;
      link_to: "bill" | "debt" | "saving";
    } | null;
  };
  balances: {
    available: number;
    account_count: number;
    upcoming_income: number;
    projected_month_end: number;
  };
  month_summary: {
    income: number;
    activity: number;
    to_be_budgeted: number;
    expenses_estimate: number;
    burn_rate: number;
    trend_percent: number;
    days_in_month: number;
    days_passed: number;
    days_left: number;
  };
  obligations: {
    upcoming_bills_amount: number;
    bill_count: number;
    items: { name: string; amount: number; due_day: number; abs_day: number }[];
  };
  next_income: { name: string; amount: number; day: number; days_until: number } | null;
  spending_flow: {
    daily_discretionary: number;
    target_per_day: number;
    // The whole month: what was actually spent up to today, where the current rate lands after it,
    // and the steady line both are read against.
    by_day: { day: number; spent: number | null; projected: number | null; target: number }[];
  };
  spending_chart: { day: number; spent: number; savings_target: number | null }[];
  categories: { name: string; amount: number }[];
  // week is the card's seven bars, oldest first, each judged against its own day's budget.
  streak: { days: number; spent_by_date: Record<string, number>; week: StreakDay[] };
  heatmap: Record<string, number>;
  cash_flow: { month: string; income: number; expenses: number; upcoming_income: number }[];
  trends: { category: string; this_month: number; last_month: number }[];
  recent_transactions: {
    id: string;
    date: string;
    amount: number;
    payee: string;
    category: string;
    memo: string | null;
    account_id: string;
    account_name: string | null;
    excluded: boolean;
  }[];
  net_worth: { checking: number; savings: number; investments: number; debts: number; net_worth: number };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function ym(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function isoDay(date: Date): string {
  return `${ym(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

// The month's income against what it will have cost by the end: what has been spent so far, the
// bills still to pay, the rest of the month at the planned discretionary rate, and the saving goal.
// Exported because the dashboard page draws the same card; two copies of this drifted apart once.
export interface MonthStatusInput {
  now: Date;
  transactions: DashTransaction[];
  monthBudgetIncome: number;
  incomes: { amount: number; is_active: boolean | number }[];
  bills: { amount: number; is_active: boolean | number; is_paid?: boolean | number }[];
  savingRate: number;
  debtMonthly: number;
  investmentMonthly: number;
  // The budget categories debt payments and investment contributions come out of, so a payment
  // already made is not counted a second time.
  commitmentCategories: string[];
}

export interface MonthStatus {
  income: number;
  expenses: number;
  spent: number;
  unpaidBills: number;
  projectedRest: number;
  savingRate: number;
  commitmentsLeft: number;
}

export function monthStatus(input: MonthStatusInput): MonthStatus {
  const { now, transactions, monthBudgetIncome, incomes, bills } = input;
  const { savingRate, debtMonthly, investmentMonthly, commitmentCategories } = input;

  const month = ym(now);
  const today = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - today;
  const monthStart = `${month}-01`;
  const todayIso = isoDay(now);

  const soFar = transactions
    .filter((t) => t.date >= monthStart && t.date <= todayIso)
    .filter((t) => t.amount < 0 && !t.excluded && !isTransfer(t.payee, t.category));
  const spent = round(soFar.reduce((s, t) => s + Math.abs(t.amount), 0));

  // Debt payments and investment contributions are taken out of the daily rate, so what has not
  // been paid yet is still owed this month. Counted from the same rows as the spending above, so
  // a payment already made cannot land in both.
  const commitmentNames = new Set(commitmentCategories.map((c) => c.toLowerCase()));
  const commitmentsPaid = soFar
    .filter((t) => commitmentNames.has((t.category ?? "").toLowerCase()))
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const commitmentsLeft = round(Math.max(0, debtMonthly + investmentMonthly - commitmentsPaid));

  const activeBills = bills.filter((b) => b.is_active);
  const billsTotal = round(activeBills.reduce((s, b) => s + b.amount, 0));
  const paidBills = round(activeBills.filter((b) => b.is_paid).reduce((s, b) => s + b.amount, 0));
  const unpaidBills = round(billsTotal - paidBills);

  const income = Math.max(
    monthBudgetIncome,
    round(incomes.filter((i) => i.is_active).reduce((s, i) => s + i.amount, 0))
  );
  const discretionaryBudget = Math.max(
    0,
    income - savingRate - billsTotal - debtMonthly - investmentMonthly
  );
  const targetPerDay = discretionaryBudget > 0 ? discretionaryBudget / daysInMonth : 0;
  const projectedRest = round(targetPerDay * daysLeft);

  return {
    income,
    expenses: round(spent + unpaidBills + commitmentsLeft + projectedRest + savingRate),
    spent,
    unpaidBills,
    commitmentsLeft,
    projectedRest,
    savingRate,
  };
}

export function buildDashboard(input: DashboardInput): DashboardModel {
  const {
    now, displayName, accounts, transactions, monthBudget, bills, incomes, debts, savingRate,
    debtMonthly, investmentMonthly, commitmentCategories, topCategories = 6,
    excludedAccountIds, linkedAccountIds, personalBudgetShare,
    budgetIncludeBills, thresholds, reserveNextMonthSaving, lastReservationMonth,
    monthlyHistory, trends, budgetByDay, streakHistory,
  } = input;

  const month = ym(now);
  const today = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - today;
  const monthStart = `${month}-01`;
  const todayIso = isoDay(now);

  // Day 0 means the last day of the month, and any day past the month's end clamps to it, so a bill
  // on the 31st still lands in June.
  const resolveDay = (day: number) => (day === 0 ? daysInMonth : Math.min(day, daysInMonth));

  const spendable = accounts.filter(
    (a) => (a.type === "checking" || a.type === "savings") && !excludedAccountIds.includes(a.id)
  );
  const availableBalance = round(spendable.reduce((s, a) => s + a.balance, 0));

  const isFixedCost = fixedCostMatcher(
    bills.map((b) => b.name ?? ""),
    accounts.filter((a) => a.type === "otherDebt").map((a) => a.name)
  );
  const monthTx = transactions.filter((t) => t.date >= monthStart && t.date <= todayIso);
  const isSpending = (t: DashTransaction) =>
    t.amount < 0 && !t.excluded && !isTransfer(t.payee, t.category);
  const isDiscretionary = (t: DashTransaction) => isSpending(t) && !isFixedCost(t.payee, t.category);

  const todaySpent = round(
    monthTx.filter((t) => t.date === todayIso && isDiscretionary(t)).reduce((s, t) => s + Math.abs(t.amount), 0)
  );
  const todaySpentPersonal = round(
    monthTx
      .filter(
        (t) =>
          t.date === todayIso &&
          isDiscretionary(t) &&
          (linkedAccountIds.length === 0 || linkedAccountIds.includes(t.account_id || ""))
      )
      .reduce((s, t) => s + Math.abs(t.amount), 0)
  );

  // Actual discretionary spend per date, which the streak reads. Snapshot rows written while the
  // dashboard happened to be open miss an evening's spending; the ledger does not.
  const spentByDate: Record<string, number> = {};
  for (const t of transactions) {
    if (!isDiscretionary(t)) continue;
    spentByDate[t.date] = round((spentByDate[t.date] ?? 0) + Math.abs(t.amount));
  }

  // The heatmap shades every expense the budget counts, transfers aside, which is a wider net than
  // the streak's discretionary-only total above.
  const heatmap: Record<string, number> = {};
  for (const t of transactions) {
    if (t.amount >= 0) continue;
    if (isTransfer(t.payee, t.category)) continue;
    heatmap[t.date] = round((heatmap[t.date] ?? 0) + Math.abs(t.amount));
  }

  const activeIncomes = incomes.filter((i) => i.is_active);
  const unreceived = activeIncomes.filter((i) => resolveDay(i.expected_day) > today && !i.received);
  const upcomingIncome = round(unreceived.reduce((s, i) => s + i.amount, 0));

  // An end-of-month payday can reserve the whole saving goal for next month, so the days after it
  // are not asked to save twice.
  const nextMonthYM = ym(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const largestIncome = [...activeIncomes].sort((a, b) => b.amount - a.amount)[0];
  const largestDay = largestIncome ? resolveDay(largestIncome.expected_day) : 0;
  const shouldReserveNow =
    reserveNextMonthSaving &&
    largestDay >= daysInMonth - 2 &&
    today >= largestDay &&
    lastReservationMonth !== nextMonthYM;

  const curMonth1 = now.getMonth() + 1;
  const nxtMonth1 = ((now.getMonth() + 1) % 12) + 1;

  const unpaidBills = bills
    .filter((b) => b.is_active && !b.is_paid && billDueInMonth(b, curMonth1))
    .map((b) => ({ amount: b.amount, dueDay: b.due_day }));
  const priorityBills = bills
    .filter((b) => b.is_active && !b.is_paid && b.is_priority && billDueInMonth(b, curMonth1))
    .map((b) => ({ amount: b.amount, dueDay: b.due_day }));
  const allPriorityBills = bills
    .filter((b) => b.is_active && b.is_priority && billDueInMonth(b, nxtMonth1))
    .map((b) => ({ amount: b.amount, dueDay: b.due_day }));
  const priorityDebts = debts.filter((d) => d.isPriority);

  // Today's spending is added back so the simulation starts from the start-of-day balance: today's
  // budget then sticks, and an overspend carries into the following days instead of vanishing.
  const budgetParams = {
    balance: availableBalance + todaySpent,
    savingGoal: savingRate,
    today,
    daysInMonth,
    extraSavingReserve: shouldReserveNow ? savingRate : 0,
    skipCurrentMonthSaving: lastReservationMonth === month,
    unpaidBills,
    debts: debts.map((d) => ({ amount: d.amount, dueDay: d.dueDay })),
    unreceivedIncomes: unreceived.map((i) => ({ amount: i.amount, expectedDay: i.expected_day })),
    allIncomes: activeIncomes.map((i) => ({ amount: i.amount, expectedDay: i.expected_day })),
    allBills: bills
      .filter((b) => b.is_active && billDueInMonth(b, nxtMonth1))
      .map((b) => ({ amount: b.amount, dueDay: b.due_day })),
    allDebts: debts.map((d) => ({ amount: d.amount, dueDay: d.dueDay })),
    resolveDay,
  };

  const withBills = calculateDailyBudget(budgetParams);
  const withoutBills = calculateDailyBudget({
    ...budgetParams,
    unpaidBills: priorityBills,
    debts: priorityDebts.map((d) => ({ amount: d.amount, dueDay: d.dueDay })),
    allBills: allPriorityBills,
    allDebts: priorityDebts.map((d) => ({ amount: d.amount, dueDay: d.dueDay })),
  });

  // Auto: include the bills only when the balance covers them and the day still leaves something to
  // live on. Otherwise the honest answer is the budget with the bills delayed.
  let useBills: boolean;
  if (budgetIncludeBills === "auto") {
    const totalUnpaid =
      unpaidBills.reduce((s, b) => s + b.amount, 0) + debts.reduce((s, d) => s + d.amount, 0);
    useBills = availableBalance + todaySpent > totalUnpaid && withBills.dailyBudget >= thresholds.normal;
  } else {
    useBills = budgetIncludeBills === true;
  }

  const budgetResult = useBills ? withBills : withoutBills;
  const dailyBudget = budgetResult.dailyBudget;

  // Income landing tomorrow has, from tomorrow's vantage point, arrived, so it belongs in tomorrow's
  // starting balance rather than in the still-future list.
  const arrivingTomorrow = round(
    activeIncomes
      .filter((i) => resolveDay(i.expected_day) === today + 1 && !i.received)
      .reduce((s, i) => s + i.amount, 0)
  );
  const tomorrowParams = {
    ...budgetParams,
    balance: availableBalance + arrivingTomorrow,
    today: today + 1,
    unreceivedIncomes: budgetParams.unreceivedIncomes.filter((i) => resolveDay(i.expectedDay) > today + 1),
  };
  const tomorrowBudget = (
    useBills
      ? calculateDailyBudget(tomorrowParams)
      : calculateDailyBudget({
          ...tomorrowParams,
          unpaidBills: priorityBills,
          debts: priorityDebts.map((d) => ({ amount: d.amount, dueDay: d.dueDay })),
          allBills: allPriorityBills,
          allDebts: priorityDebts.map((d) => ({ amount: d.amount, dueDay: d.dueDay })),
        })
  ).dailyBudget;

  const nextIncomeSource = [...unreceived].sort(
    (a, b) => resolveDay(a.expected_day) - resolveDay(b.expected_day)
  )[0];
  const wrappedIncome = [...activeIncomes].sort(
    (a, b) => resolveDay(a.expected_day) - resolveDay(b.expected_day)
  )[0];
  const nextIncome = nextIncomeSource
    ? {
        name: nextIncomeSource.name,
        amount: round(nextIncomeSource.amount),
        day: resolveDay(nextIncomeSource.expected_day),
        days_until: resolveDay(nextIncomeSource.expected_day) - today,
      }
    : wrappedIncome
      ? {
          name: wrappedIncome.name,
          amount: round(wrappedIncome.amount),
          day: resolveDay(wrappedIncome.expected_day),
          days_until: daysInMonth - today + resolveDay(wrappedIncome.expected_day),
        }
      : null;

  // When the day is tight, say which obligation took the money rather than leaving a bare number.
  const notice = (() => {
    if (dailyBudget >= thresholds.tight) return null;
    const nextIncomeDay = nextIncomeSource ? resolveDay(nextIncomeSource.expected_day) : daysInMonth;
    const preIncome: { name: string; amount: number; type: "bill" | "debt" }[] = [];
    for (const b of bills.filter((b) => b.is_active && !b.is_paid)) {
      if (b.due_day > today && b.due_day < nextIncomeDay) {
        preIncome.push({ name: b.name, amount: b.amount, type: "bill" });
      }
    }
    for (const d of debts) {
      if (d.dueDay > today && d.dueDay < nextIncomeDay && d.amount > 0) {
        preIncome.push({ name: d.name, amount: d.amount, type: "debt" });
      }
    }
    const biggest = [...preIncome].sort((a, b) => b.amount - a.amount)[0];
    const savingReserve = Math.round(budgetResult.tightestSegment?.savingGoalDeducted ?? 0);
    const obligationDominant = !!biggest && biggest.amount >= savingReserve;
    return {
      obligation_name: biggest?.name ?? "",
      obligation_amount: biggest ? Math.round(biggest.amount) : 0,
      saving_reserve: savingReserve,
      link_to: obligationDominant ? (biggest!.type === "debt" ? "debt" : "bill") : "saving",
    } as DashboardModel["daily_budget"]["notice"];
  })();

  const realSpendingTotal = round(
    monthTx.filter(isSpending).reduce((s, t) => s + Math.abs(t.amount), 0)
  );
  const burnRate = today > 0 ? round(realSpendingTotal / today) : 0;

  const activeBills = bills.filter((b) => b.is_active);
  const paidBillsAmount = round(activeBills.filter((b) => b.is_paid).reduce((s, b) => s + b.amount, 0));
  const unpaidBillsAmount = round(activeBills.reduce((s, b) => s + b.amount, 0) - paidBillsAmount);

  const discretionaryTotal = round(
    monthTx.filter(isDiscretionary).reduce((s, t) => s + Math.abs(t.amount), 0)
  );
  const dailyDiscretionary = today > 0 ? round(discretionaryTotal / today) : 0;
  const projectedMonthEnd = round(
    availableBalance + upcomingIncome - unpaidBillsAmount - dailyDiscretionary * daysLeft
  );

  // Week over week, compared as daily averages so a part-week is not read as an improvement.
  const spendInRange = (start: number, end: number) =>
    monthTx
      .filter((t) => {
        const day = parseInt(t.date.split("-")[2], 10);
        return day >= start && day <= end && isSpending(t);
      })
      .reduce((s, t) => s + Math.abs(t.amount), 0);
  const thisWeekStart = today - ((today - 1) % 7);
  const lastWeekStart = thisWeekStart - 7;
  const thisWeekDays = today - thisWeekStart + 1;
  const thisWeekDaily = thisWeekDays > 0 ? spendInRange(thisWeekStart, today) / thisWeekDays : 0;
  const lastWeekDaily = lastWeekStart >= 1 ? spendInRange(lastWeekStart, thisWeekStart - 1) / 7 : 0;
  const trendPercent = lastWeekDaily > 0 ? Math.round(((thisWeekDaily - lastWeekDaily) / lastWeekDaily) * 100) : 0;

  const combinedIncome = Math.max(
    monthBudget.income,
    round(activeIncomes.reduce((s, i) => s + i.amount, 0))
  );
  // Remaining days are projected at the planned rate, never at the month-to-date burn: one late
  // purchase should not be multiplied across the rest of the month. Shared with the web page.
  const monthExpensesEstimate = monthStatus({
    now, transactions, monthBudgetIncome: monthBudget.income, incomes, bills,
    savingRate, debtMonthly, investmentMonthly, commitmentCategories,
  }).expenses;

  const sortedSpending = [...transactions]
    .filter((t) => t.date >= monthStart && isSpending(t))
    .sort((a, b) => a.date.localeCompare(b.date));

  const discretionaryPerDay: Record<number, number> = {};
  let discCumulative = 0;
  for (const t of sortedSpending) {
    if (isFixedCost(t.payee, t.category)) continue;
    const day = parseInt(t.date.split("-")[2], 10);
    discCumulative += Math.abs(t.amount);
    discretionaryPerDay[day] = round(discCumulative);
  }
  const flowByDay = spendingFlow({
    daysInMonth,
    today,
    spentByDay: discretionaryPerDay,
    dailyDiscretionary,
    dailyBudget,
    budgetByDay,
  });

  const totalTargetPerDay =
    combinedIncome > 0 && savingRate > 0 ? (combinedIncome - savingRate) / daysInMonth : 0;
  const spendingChart: DashboardModel["spending_chart"] = [];
  let allCumulative = 0;
  const allPerDay: Record<number, number> = {};
  for (const t of sortedSpending) {
    const day = parseInt(t.date.split("-")[2], 10);
    allCumulative += Math.abs(t.amount);
    allPerDay[day] = round(allCumulative);
  }
  let carriedAll = 0;
  for (let day = 1; day <= today; day++) {
    carriedAll = allPerDay[day] ?? carriedAll;
    spendingChart.push({
      day,
      spent: carriedAll,
      savings_target: totalTargetPerDay > 0 ? Math.round(totalTargetPerDay * day) : null,
    });
  }

  const categories = monthBudget.categories
    .filter((c) => c.activity < 0 && c.name !== "Inflow: Ready to Assign")
    .sort((a, b) => a.activity - b.activity)
    .slice(0, topCategories)
    .map((c) => ({ name: c.name, amount: round(Math.abs(c.activity)) }));

  // The same streak the web card shows, from the same rows.
  const streak = streakWeek({ now, history: streakHistory, spentByDate, dailyBudget, todaySpent });

  const personalShare = (() => {
    if (personalBudgetShare > 0) return personalBudgetShare / 100;
    const personalMonthSpend = monthTx
      .filter(
        (t) => isSpending(t) && (linkedAccountIds.length === 0 || linkedAccountIds.includes(t.account_id || ""))
      )
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    return realSpendingTotal > 0 ? personalMonthSpend / realSpendingTotal : 0.5;
  })();
  const todayRemaining = round(dailyBudget - todaySpent);
  const suggestedForYou = Math.max(
    0,
    Math.min(round(dailyBudget * personalShare - todaySpentPersonal), todayRemaining)
  );

  const upcomingObligations = (() => {
    const items: { name: string; amount: number; due_day: number; abs_day: number }[] = [];
    for (const b of bills.filter((b) => b.is_active && !b.is_paid && billDueInMonth(b, curMonth1))) {
      if (b.due_day > today) items.push({ name: b.name, amount: b.amount, due_day: b.due_day, abs_day: b.due_day });
    }
    for (const b of bills.filter((b) => b.is_active && billDueInMonth(b, nxtMonth1))) {
      const absDay = daysInMonth + b.due_day;
      if (absDay - today <= 14) items.push({ name: b.name, amount: b.amount, due_day: b.due_day, abs_day: absDay });
    }
    for (const d of debts) {
      if (d.dueDay > today && d.dueDay - today <= 14 && d.amount > 0) {
        items.push({ name: d.name, amount: d.amount, due_day: d.dueDay, abs_day: d.dueDay });
      }
    }
    return items.sort((a, b) => a.abs_day - b.abs_day);
  })();

  const upcomingBillsAmount = (() => {
    const thisMonth = round(
      bills
        .filter((b) => b.is_active && !b.is_paid && billDueInMonth(b, curMonth1))
        .reduce((s, b) => s + b.amount, 0)
    );
    if (thisMonth > 0) return thisMonth;
    const nextIncomeDay = nextIncome?.day ?? daysInMonth;
    return round(
      bills
        .filter((b) => b.is_active && b.due_day <= nextIncomeDay && billDueInMonth(b, nxtMonth1))
        .reduce((s, b) => s + b.amount, 0)
    );
  })();

  const billCount = (() => {
    const unpaidNow = bills.filter((b) => b.is_active && !b.is_paid).length;
    if (unpaidNow > 0) return unpaidNow;
    const nextIncomeDay = nextIncome?.day ?? daysInMonth;
    return bills.filter((b) => b.is_active && b.due_day <= nextIncomeDay).length;
  })();

  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));

  const sumType = (type: string) =>
    round(accounts.filter((a) => a.type === type).reduce((s, a) => s + a.balance, 0));

  return {
    month,
    generated_at: now.toISOString(),
    display_name: displayName,
    currency: "EUR",
    today: {
      day: today,
      spent: todaySpent,
      spent_personal: todaySpentPersonal,
      remaining: todayRemaining,
      suggested_for_you: suggestedForYou,
    },
    daily_budget: {
      amount: dailyBudget,
      tomorrow: tomorrowBudget,
      with_bills: withBills.dailyBudget,
      without_bills: withoutBills.dailyBudget,
      bills_included: useBills,
      bills_delay_needed: !useBills && withBills.dailyBudget < withoutBills.dailyBudget,
      thresholds,
      breakdown: budgetResult.tightestSegment,
      notice,
    },
    balances: {
      available: availableBalance,
      account_count: spendable.length,
      upcoming_income: upcomingIncome,
      projected_month_end: projectedMonthEnd,
    },
    month_summary: {
      income: combinedIncome,
      activity: round(Math.abs(monthBudget.activity)),
      to_be_budgeted: round(monthBudget.toBeBudgeted),
      expenses_estimate: monthExpensesEstimate,
      burn_rate: burnRate,
      trend_percent: trendPercent,
      days_in_month: daysInMonth,
      days_passed: today,
      days_left: daysLeft,
    },
    obligations: {
      upcoming_bills_amount: upcomingBillsAmount,
      bill_count: billCount,
      items: upcomingObligations,
    },
    next_income: nextIncome,
    spending_flow: {
      daily_discretionary: dailyDiscretionary,
      target_per_day: round(dailyBudget),
      by_day: flowByDay,
    },
    spending_chart: spendingChart,
    categories,
    streak: { days: streak.current, spent_by_date: spentByDate, week: streak.days },
    heatmap,
    // The months that have a snapshot, then this one from the live ledger. A snapshot for the
    // current month may not exist yet, and when it does it is already stale, so it is replaced
    // rather than trusted - the same thing the web page does before it draws the chart.
    cash_flow: [
      // Oldest first, so a chart can draw the array as it stands.
      ...[...monthlyHistory]
        .sort((a, b) => a.month.localeCompare(b.month))
        .filter((m) => m.month !== month)
        .map((m) => ({
          month: m.month,
          income: round(m.income),
          expenses: round(m.expenses),
          upcoming_income: 0,
        })),
      {
        month,
        // Only what has arrived: the income still to come is stacked on top of this, and counting
        // it in both places drew a bar nearly twice the month's real income.
        income: round(monthBudget.received ?? Math.max(0, monthBudget.income - upcomingIncome)),
        expenses: round(Math.abs(monthBudget.activity)),
        upcoming_income: upcomingIncome,
      },
    ],
    trends: trends.map((t) => ({
      category: t.category,
      this_month: round(t.thisMonth),
      last_month: round(t.lastMonth),
    })),
    recent_transactions: [...transactions]
      .filter((t) => !isTransfer(t.payee, t.category))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8)
      .map((t) => ({
        id: t.id,
        date: t.date,
        amount: t.amount,
        payee: t.payee,
        category: t.category,
        memo: (t as { memo?: string | null }).memo ?? null,
        account_id: t.account_id ?? "",
        account_name: accountNames.get(t.account_id ?? "") ?? null,
        excluded: !!t.excluded,
      })),
    net_worth: {
      checking: sumType("checking"),
      savings: sumType("savings"),
      investments: sumType("otherAsset"),
      debts: sumType("otherDebt"),
      net_worth: round(accounts.reduce((s, a) => s + a.balance, 0)),
    },
  };
}
