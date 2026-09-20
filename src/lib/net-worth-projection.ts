// Where net worth goes from here, modelled component by component: cash, investments and debts
// each move on their own rules and are added up again every year. Shared, because the browser and
// the phone drew the same chart from two copies of this once.

export interface ProjectionInvestment {
  balance: number;
  monthlyContribution: number;
  expectedReturn: number;
}

export interface ProjectionDebt {
  balance: number;
  interestRate: number;
  minimumPayment: number;
  monthlyTarget: number;
}

export interface ProjectionInput {
  currentNetWorth: number;
  cash: number;
  investments: ProjectionInvestment[];
  debts: ProjectionDebt[];
  // Whole months only: a month still running would drag the average down.
  monthlyHistory: { income: number; expenses: number }[];
  currentYear: number;
  years?: number;
}

export interface ProjectionPoint {
  year: string;
  netWorth: number;
  baseline: number;
}

export interface Projection {
  timeline: ProjectionPoint[];
  finalValue: number;
  totalGrowth: number;
}

// The payment a debt with nothing set still gets, so a balance is never left to sit forever.
const FALLBACK_DEBT_PAYMENT = 50;
const PROJECTION_YEARS = 20;

export function netWorthProjection(input: ProjectionInput): Projection {
  const { currentNetWorth, cash: startingCash, investments, debts, monthlyHistory, currentYear } = input;
  const years = input.years ?? PROJECTION_YEARS;

  const investValue = investments.reduce((s, i) => s + i.balance, 0);
  const monthlyInvestContrib = investments.reduce((s, i) => s + i.monthlyContribution, 0);

  // Weighted by what each investment is actually fed; an account nothing goes into should not pull
  // the expected return around.
  const weightedReturn = investments.length === 0
    ? 0
    : monthlyInvestContrib > 0
      ? investments.reduce((s, i) => s + i.expectedReturn * i.monthlyContribution, 0) / monthlyInvestContrib
      : investments.reduce((s, i) => s + i.expectedReturn, 0) / investments.length;
  const monthlyReturn = weightedReturn / 100 / 12;

  // Income minus every expense, which already counts debt payments and investment contributions,
  // so this is what cash does each month on its own.
  const monthlyCashChange = monthlyHistory.length > 0
    ? monthlyHistory.reduce((s, h) => s + (h.income - h.expenses), 0) / monthlyHistory.length
    : 0;

  const simDebts = debts
    .map((d) => ({
      bal: Math.abs(d.balance),
      rate: (d.interestRate || 0) / 100 / 12,
      pay: d.minimumPayment || d.monthlyTarget || FALLBACK_DEBT_PAYMENT,
    }))
    .sort((a, b) => a.bal - b.bal);

  const timeline: ProjectionPoint[] = [
    { year: String(currentYear), netWorth: Math.round(currentNetWorth), baseline: Math.round(currentNetWorth) },
  ];

  let cash = startingCash;
  let compounded = investValue;
  let contributedOnly = investValue;

  for (let year = 1; year <= years; year++) {
    for (let month = 0; month < 12; month++) {
      cash += monthlyCashChange;

      if (simDebts.every((d) => d.bal <= 0)) {
        // Nothing left to service, so those payments stay put.
        cash += simDebts.reduce((s, d) => s + d.pay, 0);
      } else {
        let extra = 0;
        const smallestOpen = simDebts.find((d) => d.bal > 0);
        for (const debt of simDebts) {
          if (debt.bal <= 0) {
            extra += debt.pay;
            continue;
          }
          const interest = debt.bal * debt.rate;
          let payment = debt.pay + (debt === smallestOpen ? extra : 0);
          payment = Math.min(payment, debt.bal + interest);
          debt.bal = debt.bal + interest - payment;
          if (debt.bal < 1) debt.bal = 0;
          extra = 0;
        }
      }

      compounded = compounded * (1 + monthlyReturn) + monthlyInvestContrib;
      contributedOnly += monthlyInvestContrib;
    }

    const debtLeft = simDebts.reduce((s, d) => s + Math.max(0, d.bal), 0);
    timeline.push({
      year: String(currentYear + year),
      netWorth: Math.round(cash + compounded - debtLeft),
      baseline: Math.round(cash + contributedOnly - debtLeft),
    });
  }

  const finalValue = timeline[timeline.length - 1].netWorth;
  return { timeline, finalValue, totalGrowth: finalValue - Math.round(currentNetWorth) };
}
