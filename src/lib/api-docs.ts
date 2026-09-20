// The reference the api. host renders. Kept as data so the page stays a layout and one endpoint is
// described in one place. Every entry here mirrors a route under src/app/api/v1.

export interface Field {
  name: string;
  type: string;
  required?: boolean;
  description: string;
}

export interface Endpoint {
  method: "GET" | "POST";
  path: string;
  scope: "read" | "write";
  summary: string;
  localOnly?: boolean;
  params?: Field[];
  body?: Field[];
}

export interface Section {
  id: string;
  title: string;
  intro: string;
  endpoints: Endpoint[];
}

const MONTH: Field = {
  name: "month",
  type: "YYYY-MM",
  description: "Defaults to the current month in the server's timezone.",
};

export const SECTIONS: Section[] = [
  {
    id: "overview",
    title: "Overview",
    intro: "The two calls that answer how things stand, without walking every account.",
    endpoints: [
      {
        method: "GET",
        path: "/summary",
        scope: "read",
        summary:
          "Total balance, and the month's income, budgeted, activity and Ready to Assign. The first call an assistant reaches for.",
        params: [MONTH],
      },
      {
        method: "GET",
        path: "/net-worth",
        scope: "read",
        summary: "Net worth by kind (checking, savings, investments, debts) plus the saved snapshot history.",
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    intro:
      "Everything the dashboard shows, in one call: the daily budget and the reason behind it, what is left today, the obligations ahead, the charts and the month's figures. Computed by the same module the web dashboard reads, so two clients looking at one instance cannot disagree.",
    endpoints: [
      {
        method: "GET",
        path: "/dashboard",
        scope: "read",
        summary:
          "The whole dashboard model: daily budget with its breakdown and notice, today's spending and what is left, upcoming bills and income, spending flow against pace, categories, streak, trends, cash flow, recent transactions and net worth.",
      },
    ],
  },
  {
    id: "accounts",
    title: "Accounts",
    intro:
      "Balances as the app sees them. budget_excluded marks accounts left out of the spendable-balance figure, so a client can show the same number the UI does.",
    endpoints: [
      {
        method: "GET",
        path: "/accounts",
        scope: "read",
        summary: "Every open account with its balance.",
        params: [
          { name: "include_closed", type: "1", description: "Also return closed accounts." },
        ],
      },
      {
        method: "POST",
        path: "/accounts/create",
        scope: "write",
        summary: "Add a manual account.",
        body: [
          { name: "name", type: "string", required: true, description: "What the account is called." },
          { name: "type", type: "string", description: "checking, savings, otherAsset or otherDebt. Defaults to checking." },
          { name: "balance", type: "number", description: "Seeds both balance and cleared balance." },
          { name: "on_budget", type: "boolean", description: "Defaults to true." },
        ],
      },
      {
        method: "POST",
        path: "/accounts/update",
        scope: "write",
        summary:
          "Edit an account. Only the fields sent change. Setting balance records a reconciliation transaction, so history keeps adding up.",
        body: [
          { name: "id", type: "string", required: true, description: "Account id." },
          { name: "name", type: "string", description: "" },
          { name: "type", type: "string", description: "" },
          { name: "balance", type: "number", description: "" },
          { name: "on_budget", type: "boolean", description: "" },
          { name: "closed", type: "boolean", description: "" },
          { name: "sort_order", type: "number", description: "" },
        ],
      },
      {
        method: "POST",
        path: "/accounts/delete",
        scope: "write",
        summary: "Manual accounts are removed. Synced accounts are closed instead, because their history is not ours to drop.",
        body: [{ name: "id", type: "string", required: true, description: "Account id." }],
      },
    ],
  },
  {
    id: "transactions",
    title: "Transactions",
    intro:
      "The ledger. Writes here are local mode only: in YNAB mode transactions belong to YNAB and must be edited there.",
    endpoints: [
      {
        method: "GET",
        path: "/transactions",
        scope: "read",
        summary: "Transactions newest first.",
        params: [
          MONTH,
          { name: "account_id", type: "string", description: "One account." },
          { name: "category", type: "string", description: "Exact category name." },
          { name: "q", type: "string", description: "Search payee and memo." },
          { name: "limit", type: "number", description: "1 to 500, default 50." },
        ],
      },
      {
        method: "POST",
        path: "/transactions/create",
        scope: "write",
        localOnly: true,
        summary:
          "Add a transaction and apply its balance effect. Meant for rows the bank import has not seen yet, most of all pending card holds.",
        body: [
          { name: "account_id", type: "string", required: true, description: "Which account it hits." },
          { name: "amount", type: "number", required: true, description: "The absolute value; inflow decides the direction." },
          { name: "inflow", type: "boolean", description: "Defaults to false, money out." },
          { name: "date", type: "YYYY-MM-DD", description: "Defaults to today." },
          { name: "payee_name", type: "string", description: "" },
          { name: "memo", type: "string", description: "" },
          { name: "category", type: "string", description: "Category name." },
          { name: "cleared", type: "string", description: "" },
          {
            name: "transfer_account_id",
            type: "string",
            description: "With category \"Internal transfer\", creates the counterpart leg.",
          },
        ],
      },
      {
        method: "POST",
        path: "/transactions/update",
        scope: "write",
        localOnly: true,
        summary: "Patch one transaction. Only the fields sent change.",
        body: [
          { name: "transaction_id", type: "string", required: true, description: "The id the read endpoints return." },
          { name: "amount", type: "number", description: "Absolute value; inflow true stores it positive." },
          { name: "inflow", type: "boolean", description: "" },
          { name: "payee_name", type: "string", description: "" },
          { name: "memo", type: "string", description: "" },
          { name: "account_id", type: "string", description: "" },
          { name: "date", type: "YYYY-MM-DD", description: "" },
          { name: "category", type: "string", description: "" },
          {
            name: "transfer_account_id",
            type: "string",
            description: "Fixes a misrouted transfer and maintains the opposite leg.",
          },
        ],
      },
      {
        method: "POST",
        path: "/transactions/delete",
        scope: "write",
        localOnly: true,
        summary: "Remove a transaction, split siblings included, and reverse its balance effect.",
        body: [{ name: "transaction_id", type: "string", required: true, description: "" }],
      },
    ],
  },
  {
    id: "budget",
    title: "Budget",
    intro:
      "Envelope budgeting: what each category has been given, spent and has left. The same maths as the budget page, carry-forward included.",
    endpoints: [
      {
        method: "GET",
        path: "/budget",
        scope: "read",
        summary:
          "The month's income, total budgeted, Ready to Assign, age of money, and every active category's budgeted, activity and available.",
        params: [MONTH],
      },
      {
        method: "POST",
        path: "/budget/assign",
        scope: "write",
        summary: "Set, not add, one category's budgeted amount for a month.",
        body: [
          MONTH,
          { name: "category_id", type: "number", description: "Either this or category_name." },
          { name: "category_name", type: "string", description: "" },
          { name: "budgeted", type: "number", required: true, description: "The amount the category ends up with." },
        ],
      },
      {
        method: "GET",
        path: "/budget/auto-assign",
        scope: "read",
        summary:
          "Preview funding targets from Ready to Assign. Without mode, the total each mode would assign; with mode, the full per-category plan. Writes nothing.",
        params: [
          MONTH,
          { name: "mode", type: "string", description: "underfunded, last_assigned or last_spent." },
        ],
      },
      {
        method: "POST",
        path: "/budget/auto-assign",
        scope: "write",
        summary: "Apply a plan. Capped so it never overbudgets.",
        body: [
          MONTH,
          { name: "mode", type: "string", required: true, description: "underfunded, last_assigned or last_spent." },
        ],
      },
      {
        method: "POST",
        path: "/budget/move",
        scope: "write",
        summary: "Move assigned money from one category to another within a month.",
        body: [
          MONTH,
          { name: "from_category_id", type: "number", required: true, description: "" },
          { name: "to_category_id", type: "number", required: true, description: "" },
          { name: "amount", type: "number", required: true, description: "" },
        ],
      },
      {
        method: "POST",
        path: "/budget/snooze",
        scope: "write",
        summary: "Snooze a category for a month, so its target stops asking to be funded.",
        body: [
          { name: "category_id", type: "number", required: true, description: "" },
          MONTH,
        ],
      },
      {
        method: "POST",
        path: "/budget/unsnooze",
        scope: "write",
        summary: "Remove a category's snooze for a month.",
        body: [
          { name: "category_id", type: "number", required: true, description: "" },
          MONTH,
        ],
      },
    ],
  },
  {
    id: "categories",
    title: "Categories",
    intro: "The envelopes themselves, and the targets that decide what auto-assign funds.",
    endpoints: [
      {
        method: "POST",
        path: "/categories/create",
        scope: "write",
        summary: "Add a category.",
        body: [
          { name: "name", type: "string", required: true, description: "" },
          { name: "group_name", type: "string", description: "The group it sits under." },
          { name: "color", type: "string", description: "" },
        ],
      },
      {
        method: "POST",
        path: "/categories/update",
        scope: "write",
        summary:
          "Edit a category, or link it to a subscription, bill, debt account, savings goal or investment account.",
        body: [{ name: "id", type: "number", required: true, description: "Plus the fields to change." }],
      },
      {
        method: "POST",
        path: "/categories/delete",
        scope: "write",
        summary:
          "Delete a category. One with transactions needs reassign_to, and its monthly budgets merge into that target.",
        body: [
          { name: "id", type: "number", required: true, description: "" },
          { name: "reassign_to", type: "number", description: "Another category id." },
        ],
      },
      {
        method: "POST",
        path: "/categories/target",
        scope: "write",
        summary: "Set or clear a category's budget target.",
        body: [
          { name: "category_id", type: "number", required: true, description: "" },
          { name: "monthly_amount", type: "number", description: "Required unless clearing." },
          { name: "cadence", type: "string", description: "daily, weekly, monthly, yearly or by_date." },
          { name: "target_date", type: "YYYY-MM-DD", description: "With cadence by_date." },
          { name: "snooze_until_month", type: "YYYY-MM", description: "" },
          { name: "clear", type: "boolean", description: "true removes the target." },
        ],
      },
    ],
  },
  {
    id: "bills",
    title: "Bills",
    intro: "Recurring obligations with a due day, monthly or yearly.",
    endpoints: [
      { method: "GET", path: "/bills", scope: "read", summary: "Every bill with amount, due day and cadence." },
      {
        method: "POST",
        path: "/bills/create",
        scope: "write",
        summary: "Add a recurring bill.",
        body: [
          { name: "name", type: "string", required: true, description: "" },
          { name: "amount", type: "number", required: true, description: "" },
          { name: "due_day", type: "number", required: true, description: "1 to 31." },
          { name: "category", type: "string", description: "" },
          { name: "cadence", type: "string", description: "monthly or yearly." },
          { name: "due_month", type: "number", description: "1 to 12, for a yearly bill." },
        ],
      },
      {
        method: "POST",
        path: "/bills/update",
        scope: "write",
        summary: "Edit a bill, or mark this month's instance paid.",
        body: [
          { name: "id", type: "number", required: true, description: "" },
          { name: "mark_paid", type: "boolean", description: "Marks the current month paid." },
          { name: "paid_amount", type: "number", description: "What was actually paid." },
          { name: "is_priority", type: "boolean", description: "" },
          { name: "is_active", type: "boolean", description: "" },
        ],
      },
      {
        method: "POST",
        path: "/bills/delete",
        scope: "write",
        summary: "Delete a bill with its status, history and patterns.",
        body: [{ name: "id", type: "number", required: true, description: "" }],
      },
    ],
  },
  {
    id: "subscriptions",
    title: "Subscriptions",
    intro: "The smaller recurring charges, kept apart from bills so they can be counted on their own.",
    endpoints: [
      { method: "GET", path: "/subscriptions", scope: "read", summary: "Every subscription with amount and due day." },
      {
        method: "POST",
        path: "/subscriptions/create",
        scope: "write",
        summary: "Add a subscription.",
        body: [
          { name: "name", type: "string", required: true, description: "" },
          { name: "amount", type: "number", required: true, description: "" },
          { name: "due_day", type: "number", required: true, description: "1 to 31." },
          { name: "brand_color", type: "string", description: "" },
          { name: "brand_logo", type: "string", description: "" },
        ],
      },
      {
        method: "POST",
        path: "/subscriptions/update",
        scope: "write",
        summary: "Edit a subscription, or mark this month's charge paid.",
        body: [
          { name: "id", type: "number", required: true, description: "" },
          { name: "mark_paid", type: "boolean", description: "" },
        ],
      },
      {
        method: "POST",
        path: "/subscriptions/delete",
        scope: "write",
        summary: "Delete a subscription.",
        body: [{ name: "id", type: "number", required: true, description: "" }],
      },
    ],
  },
  {
    id: "income",
    title: "Income",
    intro:
      "What is expected to arrive, and whether it has. upcoming is true for an active source not yet received whose day is still ahead.",
    endpoints: [
      {
        method: "GET",
        path: "/income",
        scope: "read",
        summary: "Income sources with the month's received and upcoming status.",
        params: [MONTH],
      },
      {
        method: "POST",
        path: "/income/create",
        scope: "write",
        summary: "Add an income source.",
        body: [
          { name: "name", type: "string", required: true, description: "" },
          { name: "amount", type: "number", required: true, description: "" },
          { name: "expected_day", type: "number", required: true, description: "Day of month it usually lands." },
          { name: "is_recurring", type: "boolean", description: "" },
          { name: "target_account_id", type: "string", description: "Where it arrives." },
        ],
      },
      {
        method: "POST",
        path: "/income/update",
        scope: "write",
        summary: "Edit an income source, or mark it received this month.",
        body: [
          { name: "id", type: "number", required: true, description: "" },
          { name: "mark_received", type: "boolean", description: "" },
        ],
      },
      {
        method: "POST",
        path: "/income/delete",
        scope: "write",
        summary: "Delete an income source.",
        body: [{ name: "id", type: "number", required: true, description: "" }],
      },
    ],
  },
  {
    id: "savings-goals",
    title: "Savings goals",
    intro:
      "Saved is the linked category's available balance, assigned minus spent and carried forward, never the lifetime sum of assignments.",
    endpoints: [
      {
        method: "GET",
        path: "/savings-goals",
        scope: "read",
        summary: "Active goals with target and derived saved amount.",
        params: [MONTH],
      },
      {
        method: "POST",
        path: "/savings-goals/create",
        scope: "write",
        summary: "Add a goal, optionally linked to a budget category.",
        body: [
          { name: "name", type: "string", required: true, description: "" },
          { name: "target_amount", type: "number", required: true, description: "" },
          { name: "ynab_category_id", type: "string", description: "Link to a category by id." },
          { name: "ynab_category_name", type: "string", description: "Or by name." },
          { name: "target_date", type: "YYYY-MM-DD", description: "" },
          { name: "description", type: "string", description: "" },
        ],
      },
      {
        method: "POST",
        path: "/savings-goals/update",
        scope: "write",
        summary: "Edit a goal. Only the fields sent change.",
        body: [
          { name: "id", type: "number", required: true, description: "" },
          { name: "include_in_calculations", type: "boolean", description: "" },
          { name: "is_active", type: "boolean", description: "" },
        ],
      },
      {
        method: "POST",
        path: "/savings-goals/delete",
        scope: "write",
        summary: "Delete a goal and clear its budget link.",
        body: [{ name: "id", type: "number", required: true, description: "" }],
      },
    ],
  },
  {
    id: "debts",
    title: "Debts",
    intro: "Open otherDebt accounts with the interest rate, minimum payment and due day kept beside them.",
    endpoints: [
      { method: "GET", path: "/debts", scope: "read", summary: "Every open debt with its override fields." },
      {
        method: "POST",
        path: "/debts/update",
        scope: "write",
        summary: "Set a debt's override fields.",
        body: [
          { name: "ynab_account_id", type: "string", required: true, description: "Which debt." },
          { name: "interest_rate", type: "number", description: "Annual percentage." },
          { name: "minimum_payment", type: "number", description: "" },
          { name: "due_day", type: "number", description: "" },
          { name: "original_amount", type: "number", description: "" },
          { name: "notes", type: "string", description: "" },
          { name: "is_priority", type: "boolean", description: "" },
        ],
      },
      {
        method: "POST",
        path: "/debts/reorder",
        scope: "write",
        summary: "Set the display order.",
        body: [{ name: "order", type: "string[]", required: true, description: "Account ids, in the order wanted." }],
      },
    ],
  },
  {
    id: "investments",
    title: "Investments",
    intro: "otherAsset accounts with what goes in monthly and what return is assumed.",
    endpoints: [
      { method: "GET", path: "/investments", scope: "read", summary: "Every investment account with its overrides." },
      {
        method: "POST",
        path: "/investments/update",
        scope: "write",
        summary: "Edit an override, or re-value the account.",
        body: [
          { name: "ynab_account_id", type: "string", required: true, description: "Which account." },
          { name: "monthly_contribution", type: "number", description: "" },
          { name: "expected_return", type: "number", description: "Annual percentage." },
          { name: "value", type: "number", description: "Re-value the account to this." },
          { name: "added", type: "number", description: "Money put in alongside the re-valuation." },
          { name: "ticker", type: "string", description: "" },
          { name: "notes", type: "string", description: "" },
        ],
      },
      {
        method: "POST",
        path: "/investments/reorder",
        scope: "write",
        summary: "Set the display order.",
        body: [{ name: "order", type: "string[]", required: true, description: "Account ids, in the order wanted." }],
      },
    ],
  },
];

export const ENDPOINT_COUNT = SECTIONS.reduce((total, section) => total + section.endpoints.length, 0);
