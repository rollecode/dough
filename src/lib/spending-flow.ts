// The dashboard pace line, built once for both clients: the web page and /api/v1/dashboard call
// this, so a phone and a browser draw the same line from the same rows.
//
// Spent is the month's discretionary spending, summed day by day. The target grows by a fixed
// amount a day within a stretch. A stretch starts on the 1st and again whenever real money arrives,
// and its daily amount is the money on hand that day, less bills and the saving goal, spread until
// payday. Your own spending never lowers it, so an overspend is counted once, in the gap. A new
// stretch restarts the line from what has been spent: what came before already shows in its
// smaller or larger daily amount.
//
// A past stretch uses the figure recorded on its first day, or the day after when that is higher
// (money that landed after the dashboard was opened). A stretch nobody recorded falls back to the
// recorded daily budget, then to the first figure recorded after it, and the current one to today's.

export interface SpendingFlowInput {
  daysInMonth: number;
  // Day of the month it is now, 1-based.
  today: number;
  // Cumulative discretionary spending at the end of each day that had some.
  spentByDay: Record<number, number>;
  // The current discretionary rate, which carries the line past today.
  dailyDiscretionary: number;
  // Today's money on hand spread until payday.
  paceTarget: number;
  // The same figure recorded for past days of this month, from daily_budget_history.
  paceByDay: Record<number, number>;
  // The daily budget recorded for past days, for days recorded before paceByDay existed.
  budgetByDay: Record<number, number>;
  // Real money that arrived each day this month, transfers left out.
  incomeByDay: Record<number, number>;
}

export interface SpendingFlowDay {
  day: number;
  spent: number | null;
  projected: number | null;
  target: number;
}

// Money starts a new stretch only when it covers at least this many days of the current target, so
// a small refund does not wipe the gap.
const STRETCH_INCOME_DAYS = 3;

const round = (n: number) => Math.round(n * 100) / 100;

export interface SpendingFlow {
  days: SpendingFlowDay[];
  // The daily amount the stretch running today allows, which the API reports as target_per_day.
  perDay: number;
}

export function spendingFlow(input: SpendingFlowInput): SpendingFlow {
  const { daysInMonth, today, spentByDay, dailyDiscretionary, paceTarget, paceByDay, budgetByDay, incomeByDay } = input;

  const valueOn = (day: number): number | undefined => {
    if (day === today) return paceTarget;
    if (day > today) return undefined;
    return paceByDay[day] ?? (budgetByDay[day] > 0 ? budgetByDay[day] : undefined);
  };

  const anchorFor = (start: number): number => {
    const near = [valueOn(start), valueOn(start + 1)].filter((v): v is number => v !== undefined);
    if (near.length > 0) return Math.max(0, ...near);
    for (let day = start + 2; day <= today; day++) {
      const value = valueOn(day);
      if (value !== undefined) return Math.max(0, value);
    }
    return Math.max(0, paceTarget);
  };

  const days: SpendingFlowDay[] = [];
  let perDay = anchorFor(1);
  let target = 0;
  let spent = 0;
  let projected = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    if (day > 1 && day <= today && (incomeByDay[day] ?? 0) >= perDay * STRETCH_INCOME_DAYS) {
      perDay = anchorFor(day);
      target = spent;
      console.debug("[spending-flow] Money arrived on day", day, "new stretch at", perDay, "a day");
    }
    target += perDay;

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

  return { days, perDay: round(perDay) };
}
