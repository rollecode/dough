// Where the portfolio lands if the contributions keep coming: one pot, compounded monthly at the
// return the holdings average out to. Shared by the investments page and /api/v1/investments, so
// the browser and a phone cannot project two different futures.

export interface ProjectionHolding {
  balance: number;
  monthlyContribution: number;
  expectedReturn: number;
}

export interface InvestmentProjection {
  timeline: { year: string; value: number; invested: number }[];
  finalValue: number;
  totalInvested: number;
  totalReturns: number;
}

// What an instance assumes when a holding has no expected return of its own.
const DEFAULT_RETURN = 7;

export function calculateProjection(investments: ProjectionHolding[], years: number): InvestmentProjection {
  if (investments.length === 0) return { timeline: [], finalValue: 0, totalInvested: 0, totalReturns: 0 };

  const timeline: { year: string; value: number; invested: number }[] = [];
  let totalValue = investments.reduce((s, i) => s + i.balance, 0);
  let totalInvested = totalValue;
  const totalMonthly = investments.reduce((s, i) => s + i.monthlyContribution, 0);

  // Weighted by what each holding is actually fed, so an account nothing goes into does not pull
  // the expected return around.
  const weightedReturn = totalMonthly > 0
    ? investments.reduce((s, i) => s + i.expectedReturn * i.monthlyContribution, 0) / totalMonthly
    : investments.reduce((s, i) => s + i.expectedReturn, 0) / investments.length || DEFAULT_RETURN;

  const monthlyRate = weightedReturn / 100 / 12;

  timeline.push({ year: "0", value: Math.round(totalValue), invested: Math.round(totalInvested) });

  for (let year = 1; year <= years; year++) {
    for (let month = 0; month < 12; month++) {
      totalValue = totalValue * (1 + monthlyRate) + totalMonthly;
      totalInvested += totalMonthly;
    }
    timeline.push({ year: String(year), value: Math.round(totalValue), invested: Math.round(totalInvested) });
  }

  return {
    timeline,
    finalValue: Math.round(totalValue),
    totalInvested: Math.round(totalInvested),
    totalReturns: Math.round(totalValue - totalInvested),
  };
}
