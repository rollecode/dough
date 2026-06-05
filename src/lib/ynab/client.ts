const YNAB_BASE = "https://api.ynab.com/v1";

async function ynabFetch(path: string, token: string) {
  console.debug("[ynab] GET", path);
  const res = await fetch(`${YNAB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("[ynab] API error:", res.status, text);
    throw new Error(`YNAB API error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.data;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function getBudgetSummary(budgetId: string, token: string) {
  console.info("[ynab] Fetching budget summary for", budgetId);

  const [accountsData, categoriesData] = await Promise.all([
    ynabFetch(`/budgets/${budgetId}/accounts`, token),
    ynabFetch(`/budgets/${budgetId}/categories`, token),
  ]);

  const allAccounts = (accountsData.accounts ?? []).filter((a: any) => !a.deleted);
  const accounts = allAccounts.filter((a: any) => !a.closed);

  const totalBalance = accounts.reduce(
    (sum: number, a: any) => sum + (a.cleared_balance ?? 0) + (a.uncleared_balance ?? 0),
    0
  ) / 1000;

  const categoryGroups = categoriesData.category_groups ?? [];
  const categories = categoryGroups
    .filter((g: any) => !g.hidden && !g.deleted)
    .flatMap((g: any) =>
      (g.categories ?? [])
        .filter((c: any) => !c.hidden && !c.deleted)
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          group: g.name,
          budgeted: c.budgeted / 1000,
          activity: c.activity / 1000,
          balance: c.balance / 1000,
        }))
    );

  console.info("[ynab] Budget summary:", accounts.length, "accounts,", categories.length, "categories");

  return {
    totalBalance,
    accounts: accounts.map((a: any) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balance: ((a.cleared_balance ?? 0) + (a.uncleared_balance ?? 0)) / 1000,
      clearedBalance: (a.cleared_balance ?? 0) / 1000,
    })),
    closedAccountIds: allAccounts.filter((a: any) => a.closed).map((a: any) => a.id) as string[],
    categories,
  };
}

export async function getTransactions(
  budgetId: string,
  sinceDate?: string,
  token?: string
) {
  if (!token) throw new Error("YNAB token required");
  console.info("[ynab] Fetching transactions since", sinceDate);

  const path = sinceDate
    ? `/budgets/${budgetId}/transactions?since_date=${sinceDate}`
    : `/budgets/${budgetId}/transactions`;

  const data = await ynabFetch(path, token);
  const transactions = (data.transactions ?? []).filter((t: any) => !t.deleted);

  console.info("[ynab] Got", transactions.length, "transactions");

  return transactions.map((t: any) => ({
    id: t.id,
    date: t.date,
    amount: t.amount / 1000,
    payee: t.payee_name ?? "Unknown",
    category: t.category_name ?? "Uncategorized",
    memo: t.memo,
    approved: t.approved,
    cleared: t.cleared,
    account_id: t.account_id,
  }));
}

export async function getMonthBudget(budgetId: string, month?: string, token?: string) {
  if (!token) throw new Error("YNAB token required");
  const targetMonth = month || new Date().toISOString().slice(0, 7) + "-01";
  console.info("[ynab] Fetching month budget for", targetMonth);

  const data = await ynabFetch(`/budgets/${budgetId}/months/${targetMonth}`, token);
  const monthData = data.month ?? {};

  console.info("[ynab] Month budget: income", (monthData.income ?? 0) / 1000, "activity", (monthData.activity ?? 0) / 1000);

  return {
    income: (monthData.income ?? 0) / 1000,
    budgeted: (monthData.budgeted ?? 0) / 1000,
    activity: (monthData.activity ?? 0) / 1000,
    toBeBudgeted: (monthData.to_be_budgeted ?? 0) / 1000,
    categories: (monthData.categories ?? [])
      .filter((c: any) => !c.hidden && !c.deleted)
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        group: c.category_group_name || "",
        budgeted: c.budgeted / 1000,
        activity: c.activity / 1000,
        balance: c.balance / 1000,
      })),
  };
}

export async function createTransaction(
  budgetId: string,
  token: string,
  transaction: {
    account_id: string;
    date: string;
    amount: number; // in euros, will be converted to milliunits
    payee_name: string;
    memo?: string;
    cleared?: "cleared" | "uncleared" | "reconciled";
  }
) {
  console.info("[ynab] Creating transaction:", transaction.payee_name, transaction.amount, "on", transaction.date);

  const res = await fetch(`${YNAB_BASE}/budgets/${budgetId}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction: {
        account_id: transaction.account_id,
        date: transaction.date,
        amount: Math.round(transaction.amount * 1000),
        payee_name: transaction.payee_name,
        memo: transaction.memo || "Auto-imported via Synci",
        cleared: transaction.cleared || "cleared",
        approved: true,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[ynab] Create transaction error:", res.status, text);
    throw new Error(`YNAB create transaction error ${res.status}: ${text}`);
  }

  const json = await res.json();
  console.info("[ynab] Transaction created:", json.data?.transaction?.id);
  return json.data?.transaction;
}

// Keep for backwards compat with budgets route
export function createYnabClient(token: string) {
  const { api } = require("ynab");
  return new api(token);
}
