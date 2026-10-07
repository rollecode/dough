// The savings streak both the web card and the API report: the last six days, each judged against
// the budget the pace line gave it (the recorded daily budget for days before this month), a
// missing record breaking the run, and today counted while it is still under its budget.

export interface StreakRecord {
  date: string;
  budget: number;
  spent: number;
}

export interface StreakDay {
  day: number;
  month: number;
  status: "fire" | "fail" | "today" | "nodata";
  budget: number;
  spent: number;
}

const DAYS_SHOWN = 7;

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function streakWeek(input: {
  now: Date;
  history: StreakRecord[];
  // Real spend per date, which outranks the stored snapshot for any day it covers.
  spentByDate: Record<string, number>;
  dailyBudget: number;
  todaySpent: number;
  // This month's days as the pace line budgets them, which outranks the recorded daily budget.
  lineBudgetByDate?: Record<string, number>;
}): { days: StreakDay[]; current: number } {
  const { now, history, spentByDate, todaySpent, lineBudgetByDate = {} } = input;
  const dailyBudget = lineBudgetByDate[isoDate(now)] ?? input.dailyBudget;
  const days: StreakDay[] = [];
  let current = 0;

  for (let back = DAYS_SHOWN - 1; back >= 0; back--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const day = date.getDate();
    const month = date.getMonth() + 1;

    if (back === 0) {
      days.push({ day, month, status: "today", budget: dailyBudget, spent: todaySpent });
      continue;
    }

    const key = isoDate(date);
    const entry = history.find((h) => h.date === key);
    if (!entry) {
      current = 0;
      days.push({ day, month, status: "nodata", budget: 0, spent: 0 });
      continue;
    }

    // The stored row is a snapshot taken whenever the dashboard was last open that day, so it can
    // sit at zero for a day that had spending. Transactions are the record.
    const spent = spentByDate[key] ?? entry.spent;
    const budget = lineBudgetByDate[key] ?? entry.budget;
    if (budget > 0 && spent <= budget) {
      current++;
      days.push({ day, month, status: "fire", budget, spent });
    } else {
      current = 0;
      days.push({ day, month, status: "fail", budget, spent });
    }
  }

  if (dailyBudget > 0 && todaySpent <= dailyBudget) {
    current++;
  }
  return { days, current };
}
