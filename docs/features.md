## Features

### Dashboard

- Segment-based daily budget spanning across month boundaries to next income event
- Must-pay priority obligations always subtracted from budget regardless of mode
- Bill, debt, and investment payments excluded from discretionary daily spending
- Personal greeting with today's spending (personal + household)
- Tomorrow's budget projection with cross-month awareness
- Upcoming obligations total shown in budget note
- AI-generated financial summary with relative age display, shared across users
- Spending flow hero chart with gradient line, bubble flips on month edges
- Spending heatmap (44 weeks, scrollable, tooltip with top transactions)
- Spending trends card showing daily category comparison
- Spending chart (cumulative, excludes transfers) with savings target line
- Category breakdown pie chart
- Monthly cash flow bar chart (5 months + upcoming income as striped bar)
- Recent transactions list (excludes transfers)
- Net worth section with investments and debts
- Savings streak with emoji flames, greyscale for older days
- Entry reminder after 6 hours of no new transactions
- Burn rate and projected month-end balance
- Configurable budget thresholds (tight/normal/good)
- Auto/manual bill inclusion mode
- Personal budget share with configurable % or auto-calculated
- Configurable decimal places (0-2) for all euro amounts
- Sync button with relative last-sync time

### AI advisor (Dougie)

- Named AI advisor "Dougie" shown in menu and chat bubbles
- Chat interface with persistent message history (SQLite)
- Real-time message delivery via SSE
- Typing indicators between users
- Emoji reactions on messages with real-time sync and tooltips
- Markdown rendering with bold amounts in indigo
- Full financial context: balance, transactions (with spender names), bills, debts, income, priority flags
- Conservative advice rules with 3-day buffer requirement
- Today's spending, remaining budget, and tomorrow's budget in context
- All data read from local DB for real-time accuracy
- Per-task AI model configurable in settings, tiered by demand: routine categorizing on fast, cheap Gemini 2.5 Flash (optional key, thinking disabled, ~0.4s, falls back to Haiku CLI); demanding tasks (Dougie chat, receipt vision) on Claude Opus via the CLI (covered by the subscription, no per-token cost)
- Auto-trigger YNAB sync if cache older than 2 hours
- Message reactions context for learning preferences
- Attachments: read-only by default, expense adding only on explicit request
- Smart account detection from receipts via AI matching to YNAB account names
- Expandable textarea with inline attach/expand buttons
- Chat pagination with load older button

### Transactions

- Month-navigated view with prev/next month and a non-sticky account balance topbar (green when positive, red when negative)
- Transactions come from the bank via Synci, from YNAB, or are entered manually
- Day grouping with a heading per day and a plus on each heading to add a transaction for that day
- Shared transactions (one copy each, not per user)
- Filter by all, expenses, income or transfers, and by account (chips)
- Deep-linkable per account at `/transactions/<account>`, with a link from the edit-account modal
- Search by payee or category
- Add an expense, income, or a transfer between accounts, with AI auto-categorization and a duplicate check
- Receipt or statement photo/PDF: the AI reads it and adds one or many transactions, each with an editable category and a possible-duplicate flag
- Payee and description fields autocomplete from earlier entries (rendered in a portal so they are not clipped by the modal)
- Edit a transaction's category from the edit dialog (writes back to YNAB when connected, plus local data)
- Split a transaction across multiple categories (stored as child rows sharing a split_group, with live remaining + auto-distribute); shown as one grouped row and preserved across YNAB re-sync
- Date fields follow the configured date format with a themed calendar picker
- Floating action button for quick entry (hidden on chat page)
- Unread indicator dot when new data synced

### Budget

- YNAB-style budget page with category groups, monthly assigned amounts, activity and available
- Carryover: positive available rolls forward, overspending does not drag into the next month
- Ready to Assign carries forward across months (cumulative); within YNAB's synced range it uses YNAB's own per-month figure adjusted for local edits, and it extends the carry-forward into not-yet-synced future months so budgeting ahead stays seamless
- Assigning money to a future month lowers the current Ready to Assign (single global figure, like YNAB)
- Age of Money box (YNAB's own per-month figure) plus a 12-month history line chart with the current month as a dashed reference
- Activity is net: refunds and other inflows to a category reduce its spending and raise available, like YNAB
- Per-category targets per day, week, month or year; the amount is distributed into the month's need, with progress, single-month snooze and clear
- Auto-assign (Quick Budget): fund to targets, copy last month's assigned, or copy last month's spending
- Inline assigned editor with a calculator popover
- Category inspector (right sheet): inline-editable name, group and description, available breakdown, target editing, snooze, hide and delete
- Link a category to a subscription, bill, debt, savings goal or investment (mutually exclusive); the linked item supplies the category's target. A savings-goal link sets a by-date target and its progress is derived from what you assign, so assigning in Budget reflects in the goal (no balance mutation); debt and investment links are target/display-only
- Hidden categories with spending or assignments still appear (with a Hidden badge) and surface in the Overspent filter
- Delete a category with leftover-money reallocation (move to Ready to Assign or another category; cover an overspent category first); categories with history are archived, unused ones removed
- Delete a category group from its header, keeping its categories without a group
- Move money between categories and cover overspending, capped at the source's available balance
- Cover-from popout on overspent amounts and filters for all, overspent and money available
- Smooth drag-and-drop reorder with a dashed drop placeholder; drag a category into another group to move it
- Renaming a category rewrites its transaction history so its activity is not lost
- Hidden categories and snoozed categories sections at the bottom
- Add categories from the topbar, today button to jump back to the current month

### Accounts

- Manage accounts without YNAB: add, edit, close and delete manual accounts
- Mark a spending account and exclude accounts from the budget
- Per-account AI notes and source badges for manual, Synci and YNAB accounts
- AI balance check: enter the real bank balance and the AI explains likely duplicates or missing entries from the last few days, each shown with an inline delete
- Link to an account's transactions (also reachable at `/transactions/<account>`)

### Local data mode

- Dough works with or without YNAB: it uses YNAB when connected and its own local data when disconnected
- Synci imports all transactions straight into Dough with automatic transfer pairing in local mode
- Categories, accounts, transactions, monthly budgets and targets are all stored locally
- YNAB allocations and category groups are mirrored into the local tables so a cutover is seamless

### Bills

- Add/edit/delete recurring bills
- Must-pay priority flag (always included in budget calculation)
- Due day tracking with overdue and due-soon badges
- Manual paid/unpaid toggle (persists per month)
- YNAB payee matching for automatic paid detection
- Amount difference display when actual differs from expected
- Average amount from history (2+ months)
- Bill amount history tracking
- Brand-styled icons and colours shared with subscriptions (auto-detected from the name)

### Income

- Add/edit/delete income sources
- Day 0 = last day of month
- YNAB payee matching with wildcard patterns
- Received badge when matched to YNAB transaction
- Amount history and averages
- Synci bank integration for automatic income detection

### Debts

- From YNAB otherDebt accounts, or added manually
- Must-pay priority flag
- Editable interest rates, monthly payments and original (starting) amount
- Debt breakdown donut: each debt's share, overall payoff progress, and amount paid this month
- Per-debt percentage paid off with progress bar and balance history sparkline
- Amount paid this month derived from each account's transactions (works without YNAB)
- Linkable to a budget category so the minimum payment becomes that category's monthly target
- Snowball and avalanche payoff strategies with charts
- AI debt payoff suggestion (shared cache)
- Closed account sync from YNAB

### Investments

- From YNAB otherAsset accounts, or added manually
- Editable monthly contribution amount and expected return percentage
- Ticker tracking with Yahoo Finance and Seligson fund scraping
- Compound growth projection chart
- Monthly contributions included in dashboard month status

### Subscriptions

- Brand-styled cards with auto-detected colors and SVG logos (shared brand module, also used by bills)
- Must-pay priority flag
- Monthly and yearly cost summary
- YNAB payee matching for auto-detection
- Paid/overdue status badges
- Active/inactive toggle

### Savings goals

- Target amount, saved amount, and progress bar
- Optional target date with monthly savings calculation
- Optional budget category link, picked from grouped local categories (with the option to create one inline)
- Description field with clickable links
- AI advisor and summary are aware of all goals

### Net worth

- Snapshot history with area chart and forecast line
- 20-year projection modeling cash, investments, and debts separately
- Auto-snapshot on every sync

### Settings

- User profile: name, linked spending account
- Language: English and Finnish with live switching
- Decimal places: 0-2 decimals for euro amounts
- Household: size, description for AI, saving goal
- Budget: bill inclusion mode, threshold configuration, excluded accounts
- YNAB: connect/disconnect, budget selection, sync
- Synci: API token, bank account to YNAB account mapping
- AI prompts: editable chat guidelines, summary instructions, debt advice

### Synci integration

- Automatic bank income detection via Synci REST API polling (every 30 minutes)
- Income matched via payee patterns creates real YNAB transaction
- Bank account to YNAB account mapping in settings
- Deduplication via synci_processed table, keyed on the bank's own transaction reference so a bank reconnect (which re-issues Synci ids) never re-imports duplicates
- Transfer detection: opposite legs are auto-paired, and an inflow whose payee was previously confirmed as an internal transfer is reclassified as a transfer (learned, not hardcoded) so own-account transfers from non-synced accounts never import as income
- Unmatched inflows are categorised as Ready to Assign income, never deleted, so all money stays accounted for
- Account mapping labels show owner, account name, custom name and the account number tail to tell apart accounts that share a number
- All recurring due and expected days render as real month-aware dates (day 31 shows as the month's last valid day, day 0 means the last day)

### Real-time

- Server-Sent Events (SSE) for instant updates
- Chat messages, typing indicators, reactions, sync notifications
- Dashboard and heatmap auto-refresh when data changes
- Unread badges on sidebar for chat and transactions

### Payee matching

- Link income sources, bills, and subscriptions to YNAB payees
- Wildcard patterns for flexible matching
- Auto-match on every YNAB sync
- Date window filtering for bills to prevent previous month matches

### Internationalization

- English and Finnish
- Per-user language preference
- All UI labels, headings, badges translated
- AI responds in user's language
- Cross-month dates in Finnish format

### PWA

- iOS safe area support for standalone mode
- App icon (donut chart, white on black)
- Multiple icon sizes for all platforms
