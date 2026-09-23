import type { DoughApi } from "./tools";
import { GET as accountsGet } from "@/app/api/v1/accounts/route";
import { POST as accountsCreatePost } from "@/app/api/v1/accounts/create/route";
import { POST as accountsDeletePost } from "@/app/api/v1/accounts/delete/route";
import { POST as accountsUpdatePost } from "@/app/api/v1/accounts/update/route";
import { GET as billsGet } from "@/app/api/v1/bills/route";
import { POST as billsCreatePost } from "@/app/api/v1/bills/create/route";
import { POST as billsDeletePost } from "@/app/api/v1/bills/delete/route";
import { POST as billsUpdatePost } from "@/app/api/v1/bills/update/route";
import { GET as budgetGet } from "@/app/api/v1/budget/route";
import { POST as budgetAssignPost } from "@/app/api/v1/budget/assign/route";
import { GET as budgetAutoAssignGet, POST as budgetAutoAssignPost } from "@/app/api/v1/budget/auto-assign/route";
import { POST as budgetMovePost } from "@/app/api/v1/budget/move/route";
import { POST as budgetSnoozePost } from "@/app/api/v1/budget/snooze/route";
import { POST as budgetUnsnoozePost } from "@/app/api/v1/budget/unsnooze/route";
import { POST as categoriesCreatePost } from "@/app/api/v1/categories/create/route";
import { POST as categoriesDeletePost } from "@/app/api/v1/categories/delete/route";
import { POST as categoriesTargetPost } from "@/app/api/v1/categories/target/route";
import { POST as categoriesUpdatePost } from "@/app/api/v1/categories/update/route";
import { GET as debtsGet } from "@/app/api/v1/debts/route";
import { POST as debtsReorderPost } from "@/app/api/v1/debts/reorder/route";
import { POST as debtsUpdatePost } from "@/app/api/v1/debts/update/route";
import { GET as incomeGet } from "@/app/api/v1/income/route";
import { POST as incomeCreatePost } from "@/app/api/v1/income/create/route";
import { POST as incomeDeletePost } from "@/app/api/v1/income/delete/route";
import { POST as incomeUpdatePost } from "@/app/api/v1/income/update/route";
import { GET as investmentsGet } from "@/app/api/v1/investments/route";
import { POST as investmentsReorderPost } from "@/app/api/v1/investments/reorder/route";
import { POST as investmentsUpdatePost } from "@/app/api/v1/investments/update/route";
import { GET as netWorthGet } from "@/app/api/v1/net-worth/route";
import { GET as savingsGoalsGet } from "@/app/api/v1/savings-goals/route";
import { POST as savingsGoalsCreatePost } from "@/app/api/v1/savings-goals/create/route";
import { POST as savingsGoalsDeletePost } from "@/app/api/v1/savings-goals/delete/route";
import { POST as savingsGoalsUpdatePost } from "@/app/api/v1/savings-goals/update/route";
import { GET as subscriptionsGet } from "@/app/api/v1/subscriptions/route";
import { POST as subscriptionsCreatePost } from "@/app/api/v1/subscriptions/create/route";
import { POST as subscriptionsDeletePost } from "@/app/api/v1/subscriptions/delete/route";
import { POST as subscriptionsUpdatePost } from "@/app/api/v1/subscriptions/update/route";
import { GET as summaryGet } from "@/app/api/v1/summary/route";
import { GET as transactionsGet } from "@/app/api/v1/transactions/route";
import { POST as transactionsCreatePost } from "@/app/api/v1/transactions/create/route";
import { POST as transactionsDeletePost } from "@/app/api/v1/transactions/delete/route";
import { POST as transactionsUpdatePost } from "@/app/api/v1/transactions/update/route";

type Handler = (request: Request) => Promise<Response>;

// The v1 handlers run in this same process, so a tool call is a function call rather than a network
// round trip. Each gets the caller's own Authorization header, which keeps scopes and identity exact.
const GET_ROUTES: Record<string, Handler> = {
  "accounts": accountsGet,
  "bills": billsGet,
  "budget": budgetGet,
  "budget/auto-assign": budgetAutoAssignGet,
  "debts": debtsGet,
  "income": incomeGet,
  "investments": investmentsGet,
  "net-worth": netWorthGet,
  "savings-goals": savingsGoalsGet,
  "subscriptions": subscriptionsGet,
  "summary": summaryGet,
  "transactions": transactionsGet,
};

const POST_ROUTES: Record<string, Handler> = {
  "accounts/create": accountsCreatePost,
  "accounts/delete": accountsDeletePost,
  "accounts/update": accountsUpdatePost,
  "bills/create": billsCreatePost,
  "bills/delete": billsDeletePost,
  "bills/update": billsUpdatePost,
  "budget/assign": budgetAssignPost,
  "budget/auto-assign": budgetAutoAssignPost,
  "budget/move": budgetMovePost,
  "budget/snooze": budgetSnoozePost,
  "budget/unsnooze": budgetUnsnoozePost,
  "categories/create": categoriesCreatePost,
  "categories/delete": categoriesDeletePost,
  "categories/target": categoriesTargetPost,
  "categories/update": categoriesUpdatePost,
  "debts/reorder": debtsReorderPost,
  "debts/update": debtsUpdatePost,
  "income/create": incomeCreatePost,
  "income/delete": incomeDeletePost,
  "income/update": incomeUpdatePost,
  "investments/reorder": investmentsReorderPost,
  "investments/update": investmentsUpdatePost,
  "savings-goals/create": savingsGoalsCreatePost,
  "savings-goals/delete": savingsGoalsDeletePost,
  "savings-goals/update": savingsGoalsUpdatePost,
  "subscriptions/create": subscriptionsCreatePost,
  "subscriptions/delete": subscriptionsDeletePost,
  "subscriptions/update": subscriptionsUpdatePost,
  "transactions/create": transactionsCreatePost,
  "transactions/delete": transactionsDeletePost,
  "transactions/update": transactionsUpdatePost,
};

async function run(handler: Handler | undefined, path: string, request: Request): Promise<string> {
  if (!handler) {
    throw new Error(`Unknown Dough endpoint ${path}`);
  }
  const response = await handler(request);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Dough API returned ${response.status} for /api/v1/${path}: ${text.slice(0, 300)}`);
  }
  return text;
}

export function inProcessApi(origin: string, authorization: string): DoughApi {
  return {
    get(path, params = {}) {
      const url = new URL(`${origin}/api/v1/${path}`);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && String(value) !== "") {
          url.searchParams.set(key, String(value));
        }
      }
      return run(GET_ROUTES[path], path, new Request(url, { headers: { authorization } }));
    },
    post(path, body) {
      const request = new Request(`${origin}/api/v1/${path}`, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return run(POST_ROUTES[path], path, request);
    },
  };
}
