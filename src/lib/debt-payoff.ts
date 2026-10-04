// How long a set of debts takes to clear and what the interest costs on the way, paid smallest
// first (snowball) or dearest first (avalanche). Shared by the debts page and /api/v1/debts so the
// browser and a phone cannot answer differently.

export interface PayoffDebt {
  balance: number;
  interestRate: number;
  minimumPayment: number;
  monthlyTarget?: number;
}

export interface Payoff {
  timeline: { month: string; total: number }[];
  months: number;
  totalInterest: number;
}

// A debt with no payment set still has to be paid something, or the simulation never ends.
const ASSUMED_MINIMUM = 50;

// Ten years. Past that the answer is "not on these payments", not a longer number.
export const HORIZON_MONTHS = 120;

export function calculatePayoff(
  debts: PayoffDebt[],
  extraPayment: number,
  sortFn: (a: PayoffDebt, b: PayoffDebt) => number
): Payoff {
  if (debts.length === 0) return { timeline: [], months: 0, totalInterest: 0 };

  const sorted = [...debts].sort(sortFn);
  const balances = sorted.map((d) => d.balance);
  const rates = sorted.map((d) => d.interestRate / 100 / 12);
  const minPayments = sorted.map((d) => d.minimumPayment || d.monthlyTarget || ASSUMED_MINIMUM);
  const timeline: { month: string; total: number }[] = [];
  let month = 0;
  let totalInterest = 0;

  // The month's whole payment stays the same as debts close: every minimum plus the extra. Each open
  // debt gets its minimum first; what is left goes to the first open debt in order, then the next.
  const monthlyPool = minPayments.reduce((s, p) => s + p, 0) + extraPayment;

  while (balances.some((b) => b > 0) && month < HORIZON_MONTHS) {
    for (let i = 0; i < balances.length; i++) {
      if (balances[i] <= 0) {
        continue;
      }
      const interest = balances[i] * rates[i];
      totalInterest += interest;
      balances[i] += interest;
    }

    let pool = monthlyPool;
    for (let i = 0; i < balances.length; i++) {
      const payment = Math.min(minPayments[i], balances[i], pool);
      balances[i] -= payment;
      pool -= payment;
    }
    for (let i = 0; i < balances.length && pool > 0; i++) {
      const payment = Math.min(balances[i], pool);
      balances[i] -= payment;
      pool -= payment;
    }
    for (let i = 0; i < balances.length; i++) {
      if (balances[i] < 1) {
        balances[i] = 0;
      }
    }
    const date = new Date();
    date.setMonth(date.getMonth() + month);
    timeline.push({
      month: date.toLocaleDateString("en", { month: "short", year: "2-digit" }),
      total: Math.round(balances.reduce((s, b) => s + b, 0)),
    });
    month++;
  }

  return { timeline, months: month, totalInterest: Math.round(totalInterest) };
}

export function snowball(debts: PayoffDebt[], extraPayment = 0): Payoff {
  return calculatePayoff(debts, extraPayment, (a, b) => a.balance - b.balance);
}

export function avalanche(debts: PayoffDebt[], extraPayment = 0): Payoff {
  return calculatePayoff(debts, extraPayment, (a, b) => b.interestRate - a.interestRate);
}
