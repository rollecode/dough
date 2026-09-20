import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { cashFlowHistory } from "@/lib/budget-math";
import { netWorthProjection } from "@/lib/net-worth-projection";

// GET /api/v1/net-worth - current net worth broken down by kind, the saved snapshot history, and
// where the next twenty years take it. The projection is computed here so the browser and the
// phone cannot model the same future two different ways.
export const GET = apiRoute("read", () => {
  const db = getDb();
  const accounts = db.prepare("SELECT type, balance FROM ynab_accounts WHERE closed = 0").all() as { type: string; balance: number }[];
  const sumType = (t: string) => Math.round(accounts.filter((a) => a.type === t).reduce((s, a) => s + a.balance, 0) * 100) / 100;
  const current = {
    checking: sumType("checking"),
    savings: sumType("savings"),
    investments: sumType("otherAsset"),
    debts: sumType("otherDebt"),
    net_worth: Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100,
  };
  const history = db
    .prepare("SELECT date, checking, savings, investments, debts, net_worth FROM net_worth_snapshots ORDER BY date ASC")
    .all();

  const investments = db
    .prepare(
      "SELECT a.balance, COALESCE(o.monthly_contribution, 0) AS monthly_contribution, " +
        "COALESCE(o.expected_return, 7) AS expected_return FROM ynab_accounts a " +
        "LEFT JOIN investment_overrides o ON o.ynab_account_id = a.id " +
        "WHERE a.type = 'otherAsset' AND a.closed = 0"
    )
    .all() as { balance: number; monthly_contribution: number; expected_return: number }[];

  const debts = db
    .prepare(
      "SELECT a.balance, COALESCE(o.interest_rate, 0) AS interest_rate, " +
        "COALESCE(o.minimum_payment, 0) AS minimum_payment FROM ynab_accounts a " +
        "LEFT JOIN debt_overrides o ON o.ynab_account_id = a.id " +
        "WHERE a.type = 'otherDebt' AND a.closed = 0"
    )
    .all() as { balance: number; interest_rate: number; minimum_payment: number }[];

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const projection = netWorthProjection({
    currentNetWorth: current.net_worth,
    cash: current.checking + current.savings,
    investments: investments.map((i) => ({
      balance: i.balance,
      monthlyContribution: i.monthly_contribution,
      expectedReturn: i.expected_return,
    })),
    debts: debts.map((d) => ({
      balance: d.balance,
      interestRate: d.interest_rate,
      minimumPayment: d.minimum_payment,
      monthlyTarget: 0,
    })),
    // Whole months only, which is what cashFlowHistory before this month gives.
    monthlyHistory: cashFlowHistory(db, 6, month),
    currentYear: now.getFullYear(),
  });

  return { current, history, projection };
});
