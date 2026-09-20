import { getDb } from "./db";
import { localMonthCategories } from "./budget-math";

// What the month owes beyond its bills: the debt payments and investment contributions the plan
// sets aside. They lower the daily budget, so the month's cost has to carry them too, and the
// category each comes out of says how much of it has already left the account.

export interface Commitment {
  name: string;
  amount: number;
  dueDay: number;
  isPriority: boolean;
  category: string;
}

export interface MonthCommitments {
  debts: Commitment[];
  debtMonthly: number;
  investmentMonthly: number;
  categories: string[];
}

export function monthCommitments(db: ReturnType<typeof getDb>, month: string): MonthCommitments {
  const debtRows = db
    .prepare(
      "SELECT a.id, a.name, o.minimum_payment, o.due_day, o.is_priority, c.name AS category " +
        "FROM ynab_accounts a " +
        "LEFT JOIN debt_overrides o ON o.ynab_account_id = a.id " +
        "LEFT JOIN categories c ON c.debt_account_id = a.id " +
        "WHERE a.type = 'otherDebt' AND a.closed = 0"
    )
    .all() as {
      id: string; name: string; minimum_payment: number | null; due_day: number | null;
      is_priority: number | null; category: string | null;
    }[];

  // A debt with no minimum payment set still costs what its budget category is given, which is
  // what the debts page falls back to.
  const categories = localMonthCategories(db, month);
  const matchByName = (name: string) =>
    categories.find(
      (c) =>
        c.name.toLowerCase().includes(name.split("(")[0].trim().toLowerCase()) ||
        name.toLowerCase().includes(c.name.split("(")[0].trim().toLowerCase())
    );

  const debts: Commitment[] = debtRows.map((d) => {
    const linked = d.category ? categories.find((c) => c.name === d.category) : undefined;
    const category = linked ?? matchByName(d.name);
    return {
      name: d.name,
      amount: d.minimum_payment || (category ? Math.abs(category.budgeted) : 0) || 0,
      dueDay: d.due_day ?? 0,
      isPriority: !!d.is_priority,
      category: category?.name ?? "",
    };
  });

  const investmentMonthly = (
    db
      .prepare("SELECT COALESCE(SUM(monthly_contribution), 0) AS v FROM investment_overrides")
      .get() as { v: number }
  ).v;
  const investmentCategories = (
    db
      .prepare(
        "SELECT c.name FROM categories c JOIN investment_overrides o " +
          "ON o.ynab_account_id = c.investment_account_id WHERE o.monthly_contribution > 0"
      )
      .all() as { name: string }[]
  ).map((r) => r.name);

  return {
    debts,
    debtMonthly: debts.reduce((s, d) => s + d.amount, 0),
    investmentMonthly,
    categories: [...new Set([...debts.map((d) => d.category), ...investmentCategories])].filter(Boolean),
  };
}
