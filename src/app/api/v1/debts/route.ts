import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { localMonthCategories } from "@/lib/budget-math";
import { snowball, avalanche } from "@/lib/debt-payoff";

interface DebtRow {
  id: string; name: string; balance: number;
  interest_rate: number | null; minimum_payment: number | null; due_day: number | null;
  original_amount: number | null; notes: string | null; is_priority: number | null;
  sort_order: number | null;
}

// A debt's balance over the last twelve months, reconstructed from its own transactions:
// balance(month end) = current - everything booked after it. Same walk the debts page draws.
function debtHistory(db: ReturnType<typeof getDb>, accountId: string, currentRaw: number) {
  const txns = db
    .prepare("SELECT date, amount FROM transactions WHERE account_id = ? ORDER BY date")
    .all(accountId) as { date: string; amount: number }[];
  if (txns.length === 0) return [] as { month: string; balance: number }[];

  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const points: { month: string; balance: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const monthEnd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const after = txns.filter((t) => t.date > monthEnd).reduce((s, t) => s + t.amount, 0);
    points.push({
      month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
      balance: Math.round(Math.abs(currentRaw - after) * 100) / 100,
    });
  }
  return points;
}

// GET /api/v1/debts (read) - every open debt with what it costs, how far it has come down, what was
// paid toward it this month and twelve months of balance history.
export const GET = apiRoute("read", (request) => {
  const db = getDb();
  const rows = db.prepare(
    "SELECT a.id, a.name, a.balance, o.interest_rate, o.minimum_payment, o.due_day, o.original_amount, " +
      "o.notes, o.is_priority, o.sort_order FROM ynab_accounts a " +
      "LEFT JOIN debt_overrides o ON o.ynab_account_id = a.id " +
      "WHERE a.type = 'otherDebt' AND a.closed = 0 ORDER BY COALESCE(o.sort_order, 0), a.name"
  ).all() as DebtRow[];

  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const categories = localMonthCategories(db, month) as { name: string; budgeted: number; activity: number }[];

  // What went toward each debt this month: on a debt account a payment is a positive amount.
  const paidRows = db.prepare(
    "SELECT account_id, COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS paid " +
      "FROM transactions WHERE date >= date('now', 'start of month') GROUP BY account_id"
  ).all() as { account_id: string; paid: number }[];
  const paidThisMonth = new Map(paidRows.map((r) => [r.account_id, r.paid]));

  const debts = rows.map((d) => {
    const matching = categories.find(
      (c) =>
        c.name.toLowerCase().includes(d.name.split("(")[0].trim().toLowerCase()) ||
        d.name.toLowerCase().includes(c.name.split("(")[0].trim().toLowerCase())
    );
    const balance = Math.abs(d.balance);
    const history = debtHistory(db, d.id, d.balance);
    const peak = history.reduce((m, p) => Math.max(m, p.balance), 0);
    const original = (d.original_amount ?? 0) > 0 ? d.original_amount! : 0;
    const suggested = Math.round(Math.max(balance, peak) * 100) / 100;
    const effective = original > 0 ? original : suggested;
    const paidTotal = Math.round(Math.max(0, effective - balance) * 100) / 100;

    return {
      ynab_account_id: d.id,
      name: d.name,
      balance,
      interest_rate: d.interest_rate ?? 0,
      minimum_payment: d.minimum_payment ?? (matching ? Math.abs(matching.budgeted) : 0),
      due_day: d.due_day ?? 0,
      original_amount: original,
      suggested_original: suggested,
      paid_total: paidTotal,
      percent_paid: effective > 0 ? Math.min(100, Math.round((paidTotal / effective) * 1000) / 10) : 0,
      paid_this_month: Math.round(
        (paidThisMonth.get(d.id) ?? (matching ? Math.abs(matching.activity) : 0)) * 100
      ) / 100,
      notes: d.notes ?? "",
      is_priority: !!d.is_priority,
      history,
    };
  });

  const totalBalance = debts.reduce((s, d) => s + d.balance, 0);
  const monthlyPayments = debts.reduce((s, d) => s + Math.max(d.minimum_payment, 0), 0);

  // Both payoff orders, simulated with interest. ?extra= adds that much every month on top of the
  // minimums, which is the slider the debts page offers.
  const extra = Math.max(0, Number(new URL(request.url).searchParams.get("extra")) || 0);
  const forPayoff = debts.map((d) => ({
    balance: d.balance,
    interestRate: d.interest_rate,
    minimumPayment: d.minimum_payment,
  }));
  const bySnowball = snowball(forPayoff, extra);
  const byAvalanche = avalanche(forPayoff, extra);

  return {
    debts,
    count: debts.length,
    total_balance: Math.round(totalBalance * 100) / 100,
    monthly_payments: Math.round(monthlyPayments * 100) / 100,
    paid_this_month: Math.round(debts.reduce((s, d) => s + d.paid_this_month, 0) * 100) / 100,
    months_to_debt_free: bySnowball.months > 0 ? bySnowball.months : null,
    extra_payment: extra,
    payoff: {
      snowball: bySnowball,
      avalanche: byAvalanche,
    },
  };
});
