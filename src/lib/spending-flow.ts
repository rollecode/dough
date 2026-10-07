// The dashboard pace line, built once for both clients: the web page and /api/v1/dashboard call
// this, so a phone and a browser draw the same line from the same rows.
//
// Spent is the month's discretionary spending, summed day by day. The target grows by the daily
// budget a stretch began with. A stretch starts on the 1st, when real money arrives, and when the
// budget's 14-day window has run out. Within a stretch your own spending does not lower the target,
// so an overspend shows once, in the gap. A new stretch restarts the line from what has been spent:
// what came before already shows in its new daily budget.
//
// A past stretch uses the daily budget recorded on its first day, or the day after when that is
// higher (money that landed after the dashboard was last opened). A stretch nobody recorded uses the
// first figure recorded after it, and one starting today the live figure.

import { BUDGET_WINDOW_DAYS } from "./daily-budget";

export interface SpendingFlowInput {
  daysInMonth: number;
  // Day of the month it is now, 1-based.
  today: number;
  // Cumulative discretionary spending at the end of each day that had some.
  spentByDay: Record<number, number>;
  // The current discretionary rate, which carries the line past today.
  dailyDiscretionary: number;
  // Today's daily budget from the cash-flow simulation.
  dailyBudget: number;
  // The daily budget recorded for past days of this month, from daily_budget_history.
  budgetByDay: Record<number, number>;
  // Real money that arrived each day this month, transfers left out.
  incomeByDay: Record<number, number>;
}

export interface SpendingFlowDay {
  day: number;
  spent: number | null;
  projected: number | null;
  target: number;
  // What the day was allowed: the daily budget of the stretch it belongs to.
  budget: number;
}

// Money starts a new stretch only when it covers at least this many days of the current target, so
// a small refund does not wipe the gap.
const STRETCH_INCOME_DAYS = 3;

const round = (n: number) => Math.round(n * 100) / 100;

export function spendingFlow(input: SpendingFlowInput): SpendingFlowDay[] {
  const { daysInMonth, today, spentByDay, dailyDiscretionary, dailyBudget, budgetByDay, incomeByDay } = input;

  const budgetOn = (day: number): number | undefined => {
    if (day === today) return dailyBudget;
    if (day > today) return undefined;
    return budgetByDay[day] > 0 ? budgetByDay[day] : undefined;
  };

  const anchorFor = (start: number): number => {
    const near = [budgetOn(start), budgetOn(start + 1)].filter((v): v is number => v !== undefined);
    if (near.length > 0) return Math.max(0, ...near);
    for (let day = start + 2; day <= today; day++) {
      const value = budgetOn(day);
      if (value !== undefined) return Math.max(0, value);
    }
    return Math.max(0, dailyBudget);
  };

  const days: SpendingFlowDay[] = [];
  let perDay = anchorFor(1);
  let stretchStart = 1;
  let target = 0;
  let spent = 0;
  let projected = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const moneyArrived = (incomeByDay[day] ?? 0) >= perDay * STRETCH_INCOME_DAYS;
    const windowOver = day - stretchStart >= BUDGET_WINDOW_DAYS;
    if (day > 1 && day <= today && (moneyArrived || windowOver)) {
      perDay = anchorFor(day);
      stretchStart = day;
      target = spent;
      console.debug("[spending-flow] New stretch on day", day, moneyArrived ? "money arrived" : "window over", perDay, "a day");
    }
    target += perDay;

    if (day <= today) {
      spent = spentByDay[day] ?? spent;
      projected = spent;
      // The projection starts where the real line ends, so the two meet instead of jumping.
      days.push({ day, spent: round(spent), projected: day === today ? round(spent) : null, target: round(target), budget: round(perDay) });
      continue;
    }

    projected += dailyDiscretionary;
    days.push({ day, spent: null, projected: round(projected), target: round(target), budget: round(perDay) });
  }

  return days;
}
