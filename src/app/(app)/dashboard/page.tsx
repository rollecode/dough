"use client";

import { useState, useEffect, useCallback } from "react";
import { useEvent } from "@/lib/use-events";
import { useLocale } from "@/lib/locale-context";
import { isTransfer } from "@/lib/transaction-utils";
import { calculateDailyBudget } from "@/lib/daily-budget";
import { useYnab } from "@/lib/ynab-context";
import { DailyAllowance } from "@/components/dashboard/daily-allowance";
import { SpendingChart } from "@/components/dashboard/spending-chart";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { CashFlowChart } from "@/components/dashboard/cash-flow";
import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import { AiSummary } from "@/components/dashboard/ai-summary";
import { NetWorth } from "@/components/dashboard/net-worth";
import { EntryReminder } from "@/components/dashboard/entry-reminder";
import { PersonalGreeting } from "@/components/dashboard/personal-greeting";
import { SpendingFlow } from "@/components/dashboard/spending-flow";
import { SavingsStreak } from "@/components/dashboard/savings-streak";
import { SpendingHeatmap } from "@/components/dashboard/spending-heatmap";
import { SpendingTrends } from "@/components/dashboard/spending-trends";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fi as fiFns, enUS } from "date-fns/locale";

// Chart colors for categories
const CATEGORY_COLORS = ["#818cf8", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#71717a"];

interface IncomeSource {
  id: number;
  name: string;
  amount: number;
  expected_day: number;
  is_recurring: number;
  is_active: number;
}

export default function DashboardPage() {
  const { t, locale } = useLocale();
  const { data, loading, connected, error: ynabError, sync, savingRate, refresh } = useYnab();
  const [incomes, setIncomes] = useState<IncomeSource[]>([]);
  const [matchedIncomeIds, setMatchedIncomeIds] = useState<Set<number>>(new Set());
  const [dashInfoOpen, setDashInfoOpen] = useState(false);
  const [matchedBillIds, setMatchedBillIds] = useState<Set<number>>(new Set());
  const [bills, setBills] = useState<{ id: number; name: string; amount: number; due_day: number; is_active: number; is_paid: boolean }[]>([]);
  const [investmentMonthly, setInvestmentMonthly] = useState(0);
  const [debtMonthly, setDebtMonthly] = useState(0);
  const [debtItems, setDebtItems] = useState<{ amount: number; dueDay: number; isPriority?: boolean; name?: string }[]>([]);
  const [linkedAccountIds, setLinkedAccountIds] = useState<string[]>([]);
  const [excludedAccountIds, setExcludedAccountIds] = useState<string[]>([]);
  const [budgetIncludeBills, setBudgetIncludeBills] = useState<boolean | "auto">("auto");
  const [reserveNextMonthSaving, setReserveNextMonthSaving] = useState(false);
  const [lastReservationMonth, setLastReservationMonth] = useState<string>("");
  const [thresholds, setThresholds] = useState({ tight: 20, normal: 30, good: 50 });
  const [householdSize, setHouseholdSize] = useState(1);
  const [personalBudgetShare, setPersonalBudgetShare] = useState(0);
  const [monthlyHistory, setMonthlyHistory] = useState<{ month: string; income: number; expenses: number; categories_json?: string }[]>([]);
  const [lastYnabSync, setLastYnabSync] = useState<string | null>(null);
  const [sideDataLoaded, setSideDataLoaded] = useState(false);
  const [trendData, setTrendData] = useState<{ category: string; thisMonth: number; lastMonth: number }[]>([]);

  const loadSideData = useCallback(() => {
    Promise.all([
      fetch("/api/income").then((r) => r.json()),
      fetch("/api/matches").then((r) => r.json()),
      fetch("/api/bills").then((r) => r.json()),
      fetch("/api/profile").then((r) => r.json()),
      fetch("/api/household").then((r) => r.json()),
      fetch("/api/investments").then((r) => r.json()),
      fetch("/api/debts").then((r) => r.json()),
      fetch("/api/monthly-history").then((r) => r.json()),
      fetch("/api/subscriptions").then((r) => r.json()),
    ]).then(([incomeData, matchData, billsData, profileData, householdData, investmentData, debtData, historyData, subsData]) => {
      if (profileData.linkedAccountIds) setLinkedAccountIds(profileData.linkedAccountIds);
      if (profileData.profile?.budget_share) setPersonalBudgetShare(profileData.profile.budget_share);
      if (householdData.settings?.last_ynab_sync) setLastYnabSync(householdData.settings.last_ynab_sync);
      if (householdData.settings?.household_size) setHouseholdSize(parseInt(householdData.settings.household_size, 10) || 1);
      if (householdData.settings?.budget_excluded_accounts) {
        try { setExcludedAccountIds(JSON.parse(householdData.settings.budget_excluded_accounts)); } catch {}
      }
      if (householdData.settings?.budget_include_bills !== undefined) {
        const v = householdData.settings.budget_include_bills;
        setBudgetIncludeBills(v === "auto" ? "auto" : v === "1");
      }
      if (householdData.settings?.reserve_next_month_saving === "1") setReserveNextMonthSaving(true);
      if (householdData.settings?.last_reservation_month) setLastReservationMonth(householdData.settings.last_reservation_month);
      setThresholds({
        tight: parseInt(householdData.settings?.budget_threshold_tight) || 20,
        normal: parseInt(householdData.settings?.budget_threshold_normal) || 30,
        good: parseInt(householdData.settings?.budget_threshold_good) || 50,
      });
      if (incomeData.incomes) setIncomes(incomeData.incomes);
      // Merge subscriptions into bills for unified calculations
      const allBills = [...(billsData.bills || [])];
      if (subsData.subscriptions) {
        for (const sub of subsData.subscriptions) {
          allBills.push({ id: sub.id + 10000, name: sub.name, amount: sub.amount, due_day: sub.due_day, is_active: sub.is_active, is_paid: sub.is_paid });
        }
      }
      setBills(allBills);
      if (investmentData.investments) {
        const totalMonthly = investmentData.investments
          .reduce((s: number, i: { monthlyContribution: number }) => s + i.monthlyContribution, 0);
        setInvestmentMonthly(totalMonthly);
      }
      if (debtData.debts) {
        const totalDebtPayments = debtData.debts
          .reduce((s: number, d: { minimumPayment: number; monthlyTarget: number }) => s + (d.minimumPayment || d.monthlyTarget || 0), 0);
        setDebtMonthly(totalDebtPayments);
        setDebtItems(debtData.debts.map((d: { name: string; minimumPayment: number; monthlyTarget: number; dueDay: number; isPriority: number }) => ({
          amount: d.minimumPayment || d.monthlyTarget || 0,
          dueDay: d.dueDay || 0,
          isPriority: !!d.isPriority,
          name: d.name,
        })));
      }
      if (matchData.monthlyMatches) {
        const incIds = new Set<number>();
        const billIds = new Set<number>();
        for (const m of matchData.monthlyMatches) {
          if (m.source_type === "income") incIds.add(m.source_id);
          if (m.source_type === "bill") billIds.add(m.source_id);
        }
        setMatchedIncomeIds(incIds);
        setMatchedBillIds(billIds);
      }
      if (historyData.snapshots) setMonthlyHistory(historyData.snapshots);
      setSideDataLoaded(true);
    }).catch(() => { setSideDataLoaded(true); });
  }, []);

  useEffect(() => { loadSideData(); }, [loadSideData]);

  // Persist next-month saving reservation marker when conditions are met
  useEffect(() => {
    if (!reserveNextMonthSaving || !sideDataLoaded || incomes.length === 0) return;
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const today = now.getDate();
    const resolveDay = (day: number) => day === 0 ? daysInMonth : Math.min(day, daysInMonth);
    const nextMonthYM = (() => {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    const largest = [...incomes].filter((i) => i.is_active).sort((a, b) => b.amount - a.amount)[0];
    if (!largest) return;
    const largestDay = resolveDay(largest.expected_day);
    const isAtMonthEnd = largestDay >= daysInMonth - 2;
    if (isAtMonthEnd && today >= largestDay && lastReservationMonth !== nextMonthYM) {
      fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ last_reservation_month: nextMonthYM }),
      }).then(() => setLastReservationMonth(nextMonthYM)).catch(() => {});
    }
  }, [reserveNextMonthSaving, sideDataLoaded, incomes, lastReservationMonth]);

  useEffect(() => {
    fetch("/api/trends").then((r) => r.json()).then((d) => { if (d.trends) setTrendData(d.trends); }).catch(() => {});
  }, []);

  // SSE: re-fetch income/bills and YNAB cache when data changes
  useEvent("data:updated", useCallback(() => { loadSideData(); refresh(); }, [loadSideData, refresh]));

  // Update sync timestamp when YNAB data changes
  useEffect(() => {
    if (data?.syncedAt) setLastYnabSync(data.syncedAt);
  }, [data?.syncedAt]);


  if (loading && !data) {
    return (
      <div className="page-loading">
        <Loader2 className="page-loading-spinner animate-spin" />
      </div>
    );
  }

  if (ynabError && !data) {
    return (
      <div className="page-stack">
        <div>
          <h1 className="page-heading">{t.dashboard.title}</h1>
          <div className="error-banner">
            <p className="error-banner-text">{ynabError}</p>
            <Button variant="outline" size="sm" onClick={() => { if (typeof window !== "undefined") localStorage.removeItem("dough-last-sync"); sync(); }} disabled={loading}>
              <RefreshCw className={loading ? "icon-sm animate-spin" : "icon-sm"} />
              {locale === "fi" ? "Yritä uudelleen" : "Retry"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!connected && !data) {
    return (
      <div className="page-stack">
        <div>
          <h1 className="page-heading">{t.dashboard.title}</h1>
          <p className="page-subtitle">{t.settings.ynabDescription}</p>
        </div>
      </div>
    );
  }

  if (!data || !sideDataLoaded) return null;

  // Calculate daily budget from real data
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate();
  const monthActivity = Math.abs(data.monthBudget.activity);
  const toBeBudgeted = data.monthBudget.toBeBudgeted;

  // Real income from YNAB month budget (matches YNAB's own reports)
  const realIncome = data.monthBudget.income;

  // Available = total checking + savings accounts (excluding budget-excluded accounts)
  const availableBalance = Math.round(
    data.summary.accounts
      .filter((a) => (a.type === "checking" || a.type === "savings") && !excludedAccountIds.includes(a.id))
      .reduce((s, a) => s + a.balance, 0) * 100
  ) / 100;

  // Upcoming income = active, unmatched income sources with expected_day still ahead
  const today = now.getDate();
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const resolveDay = (day: number) => day === 0 ? lastDayOfMonth : day;
  const upcomingIncome = incomes
    .filter((i) => i.is_active && resolveDay(i.expected_day) > today && !matchedIncomeIds.has(i.id))
    .reduce((s, i) => s + i.amount, 0);

  // Today's spending — exclude bill payments (accounted for in daily budget simulation)
  // Must be calculated BEFORE dailyBudget so we can restore start-of-day balance
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const billNames = new Set(bills.map((b) => b.name?.toLowerCase()).filter(Boolean));
  // Build set of debt account names and investment-related categories for exclusion
  const debtAccountNames = new Set(
    data.summary.accounts
      .filter((a) => a.type === "otherDebt")
      .map((a) => a.name.toLowerCase())
  );
  const isFixedCost = (payee: string, category: string) => {
    const p = payee.toLowerCase();
    const c = category.toLowerCase();
    // Bill or subscription payment (check both payee and category against bill names)
    if (billNames.has(p) || [...billNames].some((bn) => p.includes(bn) || bn.includes(p))) return true;
    if ([...billNames].some((bn) => c.includes(bn) || bn.includes(c))) return true;
    // Debt payment (check both payee and category against debt account names)
    if (debtAccountNames.has(p) || [...debtAccountNames].some((dn) => p.includes(dn) || dn.includes(p))) return true;
    if (debtAccountNames.has(c) || [...debtAccountNames].some((dn) => c.includes(dn) || dn.includes(c))) return true;
    // Investment payment
    if (c.includes("sijoittaminen") || c.includes("investing") || c.includes("investment")) return true;
    return false;
  };
  const todaySpentAll = data.transactions
    .filter((t) => t.date === todayStr && t.amount < 0 && !isTransfer(t.payee, t.category) && !isFixedCost(t.payee, t.category))
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const todaySpentPersonal = data.transactions
    .filter((t) => t.date === todayStr && t.amount < 0 && !isTransfer(t.payee, t.category) && !isFixedCost(t.payee, t.category)
      && (linkedAccountIds.length === 0 || linkedAccountIds.includes(t.account_id || "")))
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  // Detect end-of-month payday reservation
  // When toggle on AND today is at/after the largest income event AND that event is in last 3 days
  // of the month, reserve a full saving goal as an extra obligation. Persist last_reservation_month
  // so the next month skips proportional saving (it's already saved).
  const currentMonthYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const nextMonthYM = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const largestIncome = [...incomes].filter((i) => i.is_active).sort((a, b) => b.amount - a.amount)[0];
  const largestIncomeDay = largestIncome ? resolveDay(largestIncome.expected_day) : 0;
  const largestIsAtMonthEnd = largestIncomeDay >= daysInMonth - 2;
  const shouldReserveNow = reserveNextMonthSaving && largestIsAtMonthEnd && today >= largestIncomeDay && lastReservationMonth !== nextMonthYM;
  const extraSavingReserve = shouldReserveNow ? savingRate : 0;
  const skipCurrentMonthSaving = lastReservationMonth === currentMonthYM;

  // Daily budget via segment-based cash flow simulation
  // Add todaySpentAll back to balance so simulation sees start-of-day balance
  // This makes today's budget "stick" — overspend/underspend carries to future days
  const budgetParams = {
    balance: availableBalance + todaySpentAll,
    savingGoal: savingRate,
    today,
    daysInMonth,
    extraSavingReserve,
    skipCurrentMonthSaving,
    unpaidBills: bills.filter((b) => b.is_active && !b.is_paid).map((b) => ({ amount: b.amount, dueDay: b.due_day })),
    debts: debtItems,
    unreceivedIncomes: incomes
      .filter((i) => i.is_active && resolveDay(i.expected_day) > today && !matchedIncomeIds.has(i.id))
      .map((i) => ({ amount: i.amount, expectedDay: i.expected_day })),
    allIncomes: incomes.filter((i) => i.is_active).map((i) => ({ amount: i.amount, expectedDay: i.expected_day })),
    allBills: bills.filter((b) => b.is_active).map((b) => ({ amount: b.amount, dueDay: b.due_day })),
    allDebts: debtItems,
    resolveDay,
  };
  // Calculate with and without bills (priority items always included in both modes)
  const priorityBills = bills.filter((b: any) => b.is_active && !b.is_paid && b.is_priority).map((b) => ({ amount: b.amount, dueDay: b.due_day }));
  const priorityDebts = debtItems.filter((d: any) => d.isPriority);
  const allPriorityBills = bills.filter((b: any) => b.is_active && b.is_priority).map((b) => ({ amount: b.amount, dueDay: b.due_day }));
  const budgetWithBills = calculateDailyBudget(budgetParams);
  const budgetWithoutBills = calculateDailyBudget({ ...budgetParams, unpaidBills: priorityBills, debts: priorityDebts, allBills: allPriorityBills, allDebts: priorityDebts });

  // Auto mode: include bills if balance covers them AND budget stays above "normal" threshold
  let useBills: boolean;
  if (budgetIncludeBills === "auto") {
    const totalUnpaidBills = budgetParams.unpaidBills.reduce((s, b) => s + b.amount, 0) + budgetParams.debts.reduce((s, d) => s + d.amount, 0);
    const canAfford = availableBalance + todaySpentAll > totalUnpaidBills && budgetWithBills.dailyBudget >= thresholds.normal;
    useBills = canAfford;
  } else {
    useBills = budgetIncludeBills === true;
  }

  const budgetResult = useBills ? budgetWithBills : budgetWithoutBills;
  const dailyBudget = budgetResult.dailyBudget;
  const billsDelayNeeded = !useBills && budgetWithBills.dailyBudget < budgetWithoutBills.dailyBudget;

  // Tomorrow's budget: re-run the engine on the money actually left (today's spend
  // already reduced the balance) as of tomorrow. No spreading of today's costs.
  const tomorrowParams = { ...budgetParams, balance: availableBalance, today: today + 1 };
  const tomorrowWithBills = calculateDailyBudget(tomorrowParams);
  const tomorrowWithoutBills = calculateDailyBudget({ ...tomorrowParams, unpaidBills: priorityBills, debts: priorityDebts, allBills: allPriorityBills, allDebts: priorityDebts });
  const tomorrowBudget = (useBills ? tomorrowWithBills : tomorrowWithoutBills).dailyBudget;

  // Budget-too-low notice: when the daily budget falls under the tight threshold,
  // surface the dominant reason and link to the page where the user can fix it.
  const budgetNotice = (() => {
    if (dailyBudget >= thresholds.tight) return null;
    const nextIncomeDay = (() => {
      const next = incomes
        .filter((i) => i.is_active && resolveDay(i.expected_day) > today && !matchedIncomeIds.has(i.id))
        .sort((a, b) => resolveDay(a.expected_day) - resolveDay(b.expected_day))[0];
      return next ? resolveDay(next.expected_day) : daysInMonth;
    })();
    // Obligations reserved from current balance because they fall before the next income
    const preIncome: { name: string; amount: number; type: "bill" | "debt" }[] = [];
    for (const b of bills.filter((b) => b.is_active && !b.is_paid)) {
      if (b.due_day > today && b.due_day < nextIncomeDay) preIncome.push({ name: b.name, amount: b.amount, type: "bill" });
    }
    for (const d of debtItems) {
      if (d.dueDay > today && d.dueDay < nextIncomeDay && d.amount > 0) preIncome.push({ name: d.name || "", amount: d.amount, type: "debt" });
    }
    const biggest = preIncome.sort((a, b) => b.amount - a.amount)[0];
    const savingReserve = Math.round(budgetResult.tightestSegment?.savingGoalDeducted ?? 0);
    // Report all contributing factors; link to the dominant one's settings page
    const obligationDominant = biggest && biggest.amount >= savingReserve;
    return {
      obligationName: biggest?.name ?? "",
      obligationAmount: biggest ? Math.round(biggest.amount) : 0,
      savingReserve,
      href: obligationDominant ? (biggest!.type === "debt" ? "/debts" : "/bills") : (savingReserve > 0 ? "/settings" : "/settings"),
      linkTo: obligationDominant ? (biggest!.type === "debt" ? "debt" : "bill") : "saving" as "debt" | "bill" | "saving",
    };
  })();

  // Persist today's daily budget for streak tracking (fire once on load)

  const todayRemaining = dailyBudget - todaySpentAll;

  // Burn rate = average daily real spending this month
  const daysPassed = now.getDate();
  const realSpendingTotal = data.transactions
    .filter((t) => t.amount < 0 && !isTransfer(t.payee, t.category))
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const dailyBurnRate = daysPassed > 0 ? Math.round((realSpendingTotal / daysPassed) * 100) / 100 : 0;

  // Separate bills from discretionary for accurate projection
  const totalBillsAmount = bills.filter((b) => b.is_active).reduce((s, b) => s + b.amount, 0);
  const paidBillsAmount = bills
    .filter((b) => b.is_active && b.is_paid)
    .reduce((s, b) => s + b.amount, 0);
  const unpaidBillsAmount = totalBillsAmount - paidBillsAmount;
  const discretionarySpending = Math.max(0, realSpendingTotal - paidBillsAmount);
  const dailyDiscretionary = daysPassed > 0 ? Math.round((discretionarySpending / daysPassed) * 100) / 100 : 0;

  const projectedMonthEnd = Math.round((availableBalance + upcomingIncome - unpaidBillsAmount - (dailyDiscretionary * daysLeft)) * 100) / 100;

  // Week-over-week spending trend
  const thisWeekStart = today - ((today - 1) % 7);
  const lastWeekStart = thisWeekStart - 7;
  const lastWeekEnd = thisWeekStart - 1;
  const thisWeekDays = today - thisWeekStart + 1;

  const spendInRange = (start: number, end: number) =>
    data.transactions
      .filter((t) => {
        const day = parseInt(t.date.split("-")[2], 10);
        return day >= start && day <= end && t.amount < 0 && !isTransfer(t.payee, t.category);
      })
      .reduce((s, t) => s + Math.abs(t.amount), 0);

  const thisWeekSpend = spendInRange(thisWeekStart, today);
  const lastWeekSpend = lastWeekStart >= 1 ? spendInRange(lastWeekStart, lastWeekEnd) : 0;

  // Normalize to daily average for fair comparison
  const thisWeekDaily = thisWeekDays > 0 ? thisWeekSpend / thisWeekDays : 0;
  const lastWeekDaily = lastWeekStart >= 1 ? lastWeekSpend / 7 : 0;
  const trendPercent = lastWeekDaily > 0 ? Math.round(((thisWeekDaily - lastWeekDaily) / lastWeekDaily) * 100) : 0;

  // Personal spending share: configured % or calculated from actual spending ratio
  const personalMonthSpend = data.transactions
    .filter((t) => t.amount < 0 && !isTransfer(t.payee, t.category)
      && (linkedAccountIds.length === 0 || linkedAccountIds.includes(t.account_id || "")))
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const calculatedShare = realSpendingTotal > 0 ? personalMonthSpend / realSpendingTotal : 0.5;
  const personalShare = personalBudgetShare > 0 ? personalBudgetShare / 100 : calculatedShare;
  const personalBudgetRaw = Math.round((dailyBudget * personalShare - todaySpentPersonal) * 100) / 100;
  const suggestedForYou = Math.max(0, Math.min(personalBudgetRaw, todayRemaining));

  // Build spending chart data from transactions (exclude transfers)
  const spendingByDay: Record<string, number> = {};
  const sortedTx = [...data.transactions]
    .filter((t) => t.amount < 0 && !isTransfer(t.payee, t.category))
    .sort((a, b) => a.date.localeCompare(b.date));

  let cumulative = 0;
  for (const tx of sortedTx) {
    const day = parseInt(tx.date.split("-")[2], 10);
    cumulative += Math.abs(tx.amount);
    spendingByDay[day] = Math.round(cumulative);
  }

  // Combined income for charts
  const totalExpectedIncome = incomes
    .filter((i) => i.is_active)
    .reduce((s, i) => s + i.amount, 0);
  const combinedIncome = Math.max(realIncome, totalExpectedIncome);

  // Discretionary budget = income minus ALL fixed costs
  const totalBillsFull = bills.filter((b) => b.is_active).reduce((s, b) => s + b.amount, 0);
  const discretionaryBudget = Math.max(0, combinedIncome - savingRate - totalBillsFull - debtMonthly - investmentMonthly);
  const discretionaryTargetPerDay = discretionaryBudget > 0 ? discretionaryBudget / daysInMonth : 0;
  console.debug("[dashboard] discretionary:", Math.round(discretionaryBudget), "daily:", Math.round(discretionaryTargetPerDay), "budget:", dailyBudget);

  // Month-end expenses estimate. The remaining days are projected at the PLANNED discretionary
  // rate (zero when there is no discretionary room), never the actual month-to-date burn.
  // Extrapolating the burn multiplied a one-off or a late-synced past purchase across the rest of
  // the month, spiking the estimate. Real past spending still counts once via realSpendingTotal.
  const monthExpensesEstimate = Math.round((realSpendingTotal + unpaidBillsAmount + (discretionaryTargetPerDay * daysLeft) + savingRate) * 100) / 100;

  // Spending chart: ALL spending with Vakaa talous target (income - savings) / days
  const totalTargetPerDay = combinedIncome > 0 && savingRate > 0
    ? (combinedIncome - savingRate) / daysInMonth
    : 0;
  const spendingData = Array.from({ length: now.getDate() }, (_, i) => ({
    date: `${i + 1}.`,
    spent: spendingByDay[i + 1] || (i > 0 ? spendingByDay[i] || 0 : 0),
    ...(totalTargetPerDay > 0 ? { savingsTarget: Math.round(totalTargetPerDay * (i + 1)) } : {}),
  }));
  // Fill forward missing days
  for (let i = 1; i < spendingData.length; i++) {
    if (spendingData[i].spent === 0 && spendingData[i - 1].spent > 0) {
      spendingData[i].spent = spendingData[i - 1].spent;
    }
  }

  // Top categories by spending this month
  const categorySpending = data.monthBudget.categories
    .filter((c) => c.activity < 0 && c.name !== "Inflow: Ready to Assign")
    .sort((a, b) => a.activity - b.activity)
    .slice(0, 6)
    .map((c, i) => ({
      name: c.name,
      amount: Math.round(Math.abs(c.activity) * 100) / 100,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }));

  const totalCategorySpending = categorySpending.reduce((s, c) => s + c.amount, 0);

  // Recent transactions (last 7, no transfers)
  const recentTransactions = [...data.transactions]
    .filter((tx) => !isTransfer(tx.payee, tx.category))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map((tx) => ({
      id: tx.id,
      date: tx.date,
      payee: tx.payee,
      category: tx.category,
      amount: tx.amount,
    }));



  // Cash flow – current month + up to 4 historical months (5 total)
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const historicalMonths = monthlyHistory
    .filter((s) => s.month !== currentMonthStr)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-4);

  const cashFlowData = [
    ...historicalMonths.map((s) => {
      const [y, m] = s.month.split("-");
      return {
        month: new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString(locale === "fi" ? "fi" : "en", { month: "short" }),
        income: Math.round(s.income * 100) / 100,
        expenses: Math.round(s.expenses * 100) / 100,
        net: Math.round((s.income - s.expenses) * 100) / 100,
        upcomingIncome: 0,
      };
    }),
    {
      month: now.toLocaleDateString(locale === "fi" ? "fi" : "en", { month: "short" }),
      income: Math.round(realIncome * 100) / 100,
      expenses: Math.round(monthActivity * 100) / 100,
      net: Math.round((realIncome - monthActivity) * 100) / 100,
      upcomingIncome: Math.round(upcomingIncome * 100) / 100,
    },
  ];

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <div>
        <h1 className="page-heading">
          {t.dashboard.title}
          <span className={`metric-info-wrap ${dashInfoOpen ? "is-open" : ""}`}>
            <button type="button" className="metric-info-trigger" onClick={() => setDashInfoOpen((v) => !v)}>
              <Info />
            </button>
            <span className="metric-info-popup">
              {locale === "fi"
                ? "Mittari voi näyttää '€ yli' vaikka tilillä on rahaa. Yli-summa muodostuu kahdesta osasta: 1) kuukauden meno ylittää tulot ja saldoa puretaan, ja 2) suunniteltuja laskuja jää maksamatta ja se raha menee päivittäiseen elämään. Tilillä on puskuria jota nakerretaan kuukausittain. Jos kuvio jatkuu, puskuri loppuu joskus. Mittari varoittaa tästä, ei siitä että rahat olisivat juuri nyt loppu."
                : "The chart can show 'over' even when there is money in the account. The over-amount is two things combined: 1) monthly spending exceeds income and the balance is being drawn down, and 2) some planned bills go unpaid and that money goes to daily life. The buffer in the account shrinks each month. If the pattern continues, the buffer eventually runs out. The chart warns about that, not about being broke today."}
            </span>
          </span>
        </h1>
        </div>
        {connected && (
          <div className="sync-row">
            {lastYnabSync && (
              <span className="sync-time">
                {formatDistanceToNow(new Date(lastYnabSync), { addSuffix: true, locale: locale === "fi" ? fiFns : enUS })}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={() => { if (typeof window !== "undefined") localStorage.removeItem("dough-last-sync"); sync(); }} disabled={loading}>
              <RefreshCw className={loading ? "icon-sm animate-spin" : "icon-sm"} />
            </Button>
          </div>
        )}
      </div>

      <EntryReminder
        lastTransactionDate={recentTransactions.length > 0 ? recentTransactions[0].date : null}
        onAddExpense={() => window.location.href = "/transactions"}
      />

      <PersonalGreeting
        todaySpentPersonal={todaySpentPersonal}
        todaySpentAll={todaySpentAll}
        dailyBudget={dailyBudget}
        todayRemaining={todayRemaining}
        suggestedForYou={suggestedForYou}
      />

      <SpendingFlow
        spendingByDay={spendingByDay as unknown as Record<number, number>}
        paidBillsAmount={paidBillsAmount}
        daysInMonth={daysInMonth}
        daysPassed={daysPassed}
        dailyDiscretionary={dailyDiscretionary}
        targetPerDay={discretionaryTargetPerDay}
        dailyBudget={dailyBudget}
      />

      <AiSummary />

      <DailyAllowance
        dailyBudget={dailyBudget}
        tomorrowBudget={tomorrowBudget}
        budgetNotice={budgetNotice}
        availableBalance={availableBalance}
        billsDelayNeeded={billsDelayNeeded}
        budgetWithBills={budgetWithBills.dailyBudget}
        thresholds={thresholds}
        upcomingBills={(() => {
          const thisMonth = bills.filter((b) => b.is_active && !b.is_paid).reduce((s, b) => s + b.amount, 0);
          if (thisMonth > 0) return thisMonth;
          // All paid this month — show next month's bills before next income
          const nextIncDay = incomes.filter((i) => i.is_active).map((i) => resolveDay(i.expected_day)).sort((a, b) => a - b)[0] || 31;
          return bills.filter((b) => b.is_active && b.due_day <= nextIncDay).reduce((s, b) => s + b.amount, 0);
        })()}
        upcomingObligations={(() => {
          const items: { name: string; amount: number; dueDay: number; absDay: number }[] = [];
          // This month's unpaid bills
          for (const b of bills.filter((b) => b.is_active && !b.is_paid)) {
            if (b.due_day > today) items.push({ name: b.name, amount: b.amount, dueDay: b.due_day, absDay: b.due_day });
          }
          // Next month's bills within 14 days
          for (const b of bills.filter((b) => b.is_active)) {
            const absDay = daysInMonth + b.due_day;
            if (absDay - today <= 14 && absDay > daysInMonth) items.push({ name: b.name, amount: b.amount, dueDay: b.due_day, absDay });
          }
          // Debts within 14 days
          for (const d of data.summary.accounts.filter((a) => a.type === "otherDebt")) {
            const override = debtItems.find((di) => di.dueDay > 0);
            if (override && override.dueDay > today && override.dueDay - today <= 14) {
              items.push({ name: d.name, amount: override.amount, dueDay: override.dueDay, absDay: override.dueDay });
            }
          }
          return items.sort((a, b) => a.absDay - b.absDay);
        })()}
        accountCount={data.summary.accounts.filter((a) => (a.type === "checking" || a.type === "savings") && !excludedAccountIds.includes(a.id)).length}
        billCount={(() => {
          const thisMonth = bills.filter((b) => b.is_active && !b.is_paid).length;
          if (thisMonth > 0) return thisMonth;
          const nextIncDay = incomes.filter((i) => i.is_active).map((i) => resolveDay(i.expected_day)).sort((a, b) => a - b)[0] || 31;
          return bills.filter((b) => b.is_active && b.due_day <= nextIncDay).length;
        })()}
        nextIncomeAmount={(() => {
          const next = incomes
            .filter((i) => i.is_active && resolveDay(i.expected_day) > today && !matchedIncomeIds.has(i.id))
            .sort((a, b) => a.expected_day - b.expected_day)[0];
          if (next) return next.amount;
          // Wrap to next month
          const nextMonth = incomes.filter((i) => i.is_active).sort((a, b) => resolveDay(a.expected_day) - resolveDay(b.expected_day))[0];
          return nextMonth?.amount ?? 0;
        })()}
        nextIncomeDate={(() => {
          const next = incomes
            .filter((i) => i.is_active && resolveDay(i.expected_day) > today && !matchedIncomeIds.has(i.id))
            .sort((a, b) => a.expected_day - b.expected_day)[0];
          if (next) return `${next.expected_day}.${now.getMonth() + 1}. – ${next.name}`;
          // Wrap to next month
          const nextMonth = incomes.filter((i) => i.is_active).sort((a, b) => resolveDay(a.expected_day) - resolveDay(b.expected_day))[0];
          if (!nextMonth) return "";
          const nextMonthNum = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2;
          return `${resolveDay(nextMonth.expected_day)}.${nextMonthNum}. – ${nextMonth.name}`;
        })()}
        daysUntilIncome={(() => {
          const next = incomes
            .filter((i) => i.is_active && resolveDay(i.expected_day) > today && !matchedIncomeIds.has(i.id))
            .sort((a, b) => a.expected_day - b.expected_day)[0];
          if (next) return next.expected_day - today;
          // No more income this month — find earliest income in next month
          const allDays = incomes.filter((i) => i.is_active).map((i) => resolveDay(i.expected_day)).sort((a, b) => a - b);
          return allDays.length > 0 ? (daysInMonth - today) + allDays[0] : daysLeft;
        })()}
        burnRate={dailyBurnRate}
        projectedMonthEnd={projectedMonthEnd}
        todaySpentAll={todaySpentAll}
        todayRemaining={todayRemaining}
        monthIncome={combinedIncome}
        monthExpenses={monthExpensesEstimate}
        trendPercent={trendPercent}
        budgetBreakdown={budgetResult.tightestSegment}
        streakProps={{ dailyBudget, todaySpent: todaySpentAll, discretionaryTarget: discretionaryTargetPerDay }}
      />

      <div className="page-grid-2">
        <SpendingHeatmap />
        <SpendingTrends trends={trendData} />
      </div>

      <div className="page-grid-2">
        <SpendingChart data={spendingData} />
        <CategoryBreakdown
          categories={categorySpending}
          total={totalCategorySpending}
        />
      </div>

      <div className="page-grid-2">
        <CashFlowChart data={cashFlowData} />
        <RecentTransactions transactions={recentTransactions} />
      </div>

      <NetWorth accounts={data.summary.accounts} />
    </div>
  );
}
