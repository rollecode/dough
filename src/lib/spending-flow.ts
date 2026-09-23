// The dashboard pace line, built once for both clients: the web page and /api/v1/dashboard call
// this, so a phone and a browser draw the same line from the same rows.
//
// Spent is the month's discretionary spending, summed day by day. It is read against the sum of
// each day's own daily budget, the figure the cash-flow simulation allowed that day. Spreading the
// month's income evenly instead reads green all month when most of the money only arrives late:
// the even share is far above what the account can actually carry until then.
//
// A past day uses the daily budget recorded for it. A day nobody opened falls back to the earliest
// one recorded this month, and today and the days after use the live figure.

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
}

export interface SpendingFlowDay {
  day: number;
  spent: number | null;
  projected: number | null;
  target: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function spendingFlow(input: SpendingFlowInput): SpendingFlowDay[] {
  const { daysInMonth, today, spentByDay, dailyDiscretionary, dailyBudget, budgetByDay } = input;

  const recorded = Object.keys(budgetByDay)
    .map(Number)
    .filter((day) => day < today && budgetByDay[day] > 0)
    .sort((a, b) => a - b);
  const earliest = recorded.length > 0 ? budgetByDay[recorded[0]] : dailyBudget;

  const days: SpendingFlowDay[] = [];
  let target = 0;
  let spent = 0;
  let projected = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const allowance = day < today ? (budgetByDay[day] > 0 ? budgetByDay[day] : earliest) : dailyBudget;
    target += Math.max(0, allowance);

    if (day <= today) {
      spent = spentByDay[day] ?? spent;
      projected = spent;
      // The projection starts where the real line ends, so the two meet instead of jumping.
      days.push({ day, spent: round(spent), projected: day === today ? round(spent) : null, target: round(target) });
      continue;
    }

    projected += dailyDiscretionary;
    days.push({ day, spent: null, projected: round(projected), target: round(target) });
  }

  return days;
}
