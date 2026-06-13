## Architecture

### Tech stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **UI primitives**: @base-ui/react (headless components)
- **CSS**: Custom SMACSS-derivative framework (`src/styles/`)
- **Database**: SQLite via better-sqlite3
- **Auth**: JWT sessions with httpOnly cookies
- **Icons**: lucide-react
- **Charts**: Recharts
- **i18n**: Custom locale system with React context
- **AI**: Claude CLI via stdin pipe (Opus); optional Google Gemini for categorization
- **Real-time**: Server-Sent Events (in-process EventBus)
- **Finance data**: local SQLite, optionally mirrored from the YNAB REST API
- **Bank sync**: Synci REST API (optional transaction import: income, expenses, transfers)

### Directory structure

```
src/
  app/                    # Next.js app router pages
    (app)/                # Authenticated app pages
    api/                  # API routes
      chat/               # Chat messages, reactions, typing
      synci/              # Synci bank sync (accounts, sync)
      ynab/               # YNAB sync, transactions, accounts
      heatmap/            # Spending heatmap data
      summary/            # AI financial summary
    login/                # Public login page
  components/
    ui/                   # Reusable UI components
    layout/               # App shell, sidebar, FAB
    dashboard/            # Dashboard components
    chat/                 # Chat interface
    shared/               # Shared components (add expense dialog)
  lib/
    auth.ts               # JWT session management
    db.ts                 # SQLite database + schema init + migrations
    event-bus.ts          # In-memory pub/sub for SSE
    use-events.ts         # Client-side SSE hook
    daily-budget.ts       # Segment-based cash flow simulation
    household.ts          # Shared household settings helpers
    matching.ts           # YNAB payee matching engine
    transaction-utils.ts  # Transfer detection helpers
    date-utils.ts         # Date formatting
    locale-context.tsx    # React context for i18n
    ynab-context.tsx      # React context for YNAB data
    ai/
      finance-advisor.ts  # Claude CLI integration for Dougie
      claude-image.ts     # Claude vision for receipts
      default-prompts.ts  # Default AI prompt templates
    ynab/
      client.ts           # YNAB REST API client (read + create)
    i18n/
      en.ts, fi.ts        # Translation files
  styles/
    theme.css             # CSS custom properties (light/dark)
    base.css              # Resets, typography
    animations.css        # Keyframes
    state.css             # State classes
    layout.css            # App shell, sidebar, FAB, PWA safe areas
    modules/              # Per-component CSS modules
    index.css             # Single entry point
middleware.ts             # Auth middleware with exemptions
data/                     # SQLite database (gitignored)
docs/                     # Documentation
```

### Database tables

- `users` — user accounts with locale, budget share
- `user_linked_accounts` — per-user linked YNAB spending accounts
- `household_settings` — shared key-value settings
- `transactions` — shared transactions from YNAB, Synci or manual entry (unique on ynab_id)
- `recurring_bills` — monthly bills with is_priority flag
- `bill_amount_history` — bill amount tracking per month
- `bill_manual_status` — manual paid/unpaid overrides per month
- `income_sources` — income sources with expected day
- `income_amount_history` — income amount tracking per month
- `debt_overrides` — interest rate, payment, priority overrides
- `investment_overrides` — contribution, return, ticker overrides
- `subscriptions` — recurring subscriptions with brand styling and priority
- `account_notes` — per-account notes for AI context
- `savings_goals` — savings targets with progress
- `payee_matches` — YNAB payee patterns with optional amount range
- `monthly_matches` — matched transactions per source per month
- `chat_messages` — shared chat history with image thumbnails
- `chat_reactions` — emoji reactions on chat messages
- `chat_last_seen` — per-user read tracking
- `typing_status` — real-time typing indicators
- `transactions_last_seen` — per-user transaction read tracking
- `daily_budget_history` — daily budget and spending for savings streak
- `net_worth_snapshots` — daily net worth history
- `monthly_snapshots` — monthly income/expenses/categories for trends
- `ai_summaries` — cached AI summaries per locale (shared across users)
- `synci_processed` — tracks processed Synci transaction IDs
- `categories` — local budget categories with group, order and description
- `monthly_category_budgets` — assigned amount per category per month
- `category_targets` — per-category target amount and cadence (day/week/month/year)
- `category_snoozes` — per-month snooze of a category's target
- `category_opening_balances` — per-category carry-in balance at the first local month (cutover anchor)
- `ynab_accounts` — cached accounts (all, incl. closed) with type and on-budget flag
- `ynab_categories` — cached YNAB categories per month
- `ynab_month_budget` — cached YNAB month budget data
- `ticker_cache` — cached stock/fund ticker data

### Data flow

1. YNAB sync fetches accounts, transactions and the month budget. The first sync imports the full history (every month and transaction back to the budget's first month) so years of progress can be compared; later syncs only need a recent window since older months never change
2. Per-month category detail (budgeted, activity, balance) is persisted for every month, not just the current one
3. All accounts are persisted including closed ones, each with YNAB's real on-budget flag (needed to classify transfers)
4. Data persisted to local SQLite tables
5. Auto-match runs against payee patterns
6. Deleted YNAB transactions removed from local DB (current month only)
7. Net worth and monthly snapshots saved
8. Local categories, monthly budgets and opening balances are seeded from the YNAB mirror so a cutover to local mode is seamless
9. SSE broadcasts `sync:complete` and `data:updated` to all clients
10. Dashboards, heatmap, and chat re-fetch from local DB

### Budget calculation

Segment-based cash flow simulation (`src/lib/daily-budget.ts`):

1. Spans from today to next income event (wraps across month boundary)
2. Builds segments between income events
3. Subtracts obligations (bills, debts) due in each segment
4. Savings goal deducted from last segment
5. Daily budget = tightest segment's pool / days
6. Must-pay priority items always subtracted regardless of auto mode
7. Non-priority items optionally included based on settings

### Budget carryover and parity

The budget page mirrors YNAB's category balances in local mode (`src/lib/budget-math.ts`):

1. A category's available balance is replayed month by month: `available = carry-in + budgeted - activity`, where positive available rolls forward and negative resets to zero (YNAB default)
2. The replay reads all months in two bulk queries per category (budgeted by month, activity by month) rather than a query per month, so a multi-year history stays fast
3. Activity is every transaction in the category except transfers between on-budget accounts. A transfer to an off-budget (tracking) account, such as investing or paying down a debt, counts as activity; categorised reconciliation and balance adjustments count too. The counterparty is the account named after `Transfer : `, matched to `ynab_accounts.on_budget`
4. `category_opening_balances` holds each category's carry-in as of the first local month, seeded from the YNAB mirror at cutover. When a sync only imported a shallow window, this keeps accumulated savings and buffers exact without replaying months that were never imported. With full history imported, the anchor sits at the budget's first month and is effectively zero
5. Ready to Assign, income and Age of Money come from `monthBudgetNumbers` and the `ynab_month_budget` mirror, independent of the per-category replay

### AI integration

Claude CLI invoked via `spawn` with Opus model. Features:

1. **Dougie (chat advisor)** — full conversation with financial context, priority awareness, conservative advice
2. **AI summary** — cached, shared across users, reads from local DB
3. **Debt suggestion** — one-shot advice, shared cache
4. **Receipt parsing** — Claude vision extracts amounts, payees, dates, accounts
5. **Transaction categorization** — AI picks a budget category for new transactions (Claude CLI, or fast Gemini when a key is set)
6. **Balance reconcile** — AI compares an account to the real bank balance and explains duplicates or missing entries over the last 7 days

### Synci integration

Polls Synci REST API every 30 minutes via systemd timer (see setup.md). Per mapped bank account:

1. Fetches transactions for the account
2. Attributes each to the account it actually arrived on (the polled account's mapping wins over an income source's configured account)
3. Local mode: imports every transaction (income and expense); YNAB mode: income only (YNAB imports the rest from the bank)
4. Skips anything already added manually (same account, amount and date) so it never duplicates
5. Auto-categorizes freshly imported expenses with the fast AI path (shared categorizer)
6. Auto-pairs opposite-sign equal-magnitude transactions on different accounts within 2 days as internal transfers, tagging both legs with an internal-transfer category so they stay out of spending and income
7. Inflows are categorised to Ready to Assign (counted as income, recorded in monthly_matches) only when they match a household income source. Other inflows are imported provisionally and kept only if they pair into an internal transfer; an unmatched, unpaired inflow (such as company money passing through a personal account) is removed so it never inflates balances or income
8. Updates local account balances; deduplicates re-imports via the synci_processed table

### Authentication flow

1. User submits credentials to `POST /api/auth/login`
2. Server validates against SQLite, returns JWT in httpOnly cookie
3. Middleware checks JWT on every request
4. Exempted: `/api/auth`, `/api/events`, `/api/synci/sync` (cron secret)
5. Unauthenticated requests redirect to `/login`

### CSS naming convention

- Module root: `.card`, `.button`, `.dialog`
- Sub-elements: `.card-header`, `.card-title`
- Layout: `.l-app-shell`, `.l-sidebar`, `.l-page-container`
- State: `.is-active`, `.is-disabled`, `.is-paid`, `.is-priority`
- Variants: `[data-variant="outline"]`, `[data-size="sm"]`
- Overrides use compound selectors: `.card.metric-card`
