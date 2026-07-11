import type Database from "better-sqlite3";
import { getDb } from "./db";
import { localMonthCategories, NOT_BUDGET_EXCLUDED } from "./budget-math";

/**
 * Assemble a financial-context object from Dough's own local tables, in the same
 * shape the YNAB cache (`ynab_cache.data`) uses. This lets the AI features (summary,
 * chat, debt suggestion) work without YNAB connected, reading accounts, categories,
 * transactions and the month budget straight from local data.
 */
export function buildLocalFinancialData(database: Database.Database = getDb()) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = `${month}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

  const accounts = database
    .prepare(
      "SELECT id, name, type, balance, COALESCE(cleared_balance, balance) AS clearedBalance FROM ynab_accounts WHERE closed = 0"
    )
    .all() as { id: string; name: string; type: string; balance: number; clearedBalance: number }[];
  const totalBalance = Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100;

  // Per-category budgeted / activity / available, from the shared local computation. Activity keeps
  // YNAB's sign convention (negative for spending) and the balance carries over month to month, so
  // the AI features read categories the same way they would from the YNAB cache.
  const categories = localMonthCategories(database, month);

  // Recent transactions (last ~10 months), deduped by source id
  const tenMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 9, 1);
  const since = `${tenMonthsAgo.getFullYear()}-${String(tenMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;
  const transactions = database
    .prepare(
      "SELECT ynab_id AS id, date, amount, payee, category, memo, account_id FROM transactions WHERE date >= ? AND " + NOT_BUDGET_EXCLUDED + " GROUP BY ynab_id ORDER BY date DESC"
    )
    .all(since) as { id: string; date: string; amount: number; payee: string; category: string; memo: string | null; account_id: string }[];

  // Month income from this month's inflows (excluding transfers/starting/reconciliation), with income_sources as a floor
  const monthTx = transactions.filter((t) => t.date >= monthStart && t.date <= monthEnd);
  const txIncome = monthTx
    .filter((t) => t.amount > 0 && !t.payee.startsWith("Transfer") && !t.payee.startsWith("Starting") && !t.payee.startsWith("Reconciliation"))
    .reduce((s, t) => s + t.amount, 0);
  const expectedIncome = (database.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM income_sources WHERE is_active = 1").get() as { v: number }).v || 0;
  const income = Math.round(Math.max(txIncome, expectedIncome) * 100) / 100;

  const budgeted = Math.round(categories.reduce((s, c) => s + c.budgeted, 0) * 100) / 100;
  const activity = Math.round(categories.reduce((s, c) => s + c.activity, 0) * 100) / 100;
  const toBeBudgeted = Math.round((income - budgeted) * 100) / 100;

  return {
    summary: { totalBalance, accounts, categories },
    transactions,
    monthBudget: { income, budgeted, activity, toBeBudgeted, categories },
    syncedAt: now.toISOString(),
  };
}
