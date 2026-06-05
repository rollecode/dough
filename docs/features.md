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
- Auto-trigger YNAB sync if cache older than 2 hours
- Message reactions context for learning preferences
- Attachments: read-only by default, expense adding only on explicit request
- Smart account detection from receipts via AI matching to YNAB account names
- Expandable textarea with inline attach/expand buttons
- Chat pagination with load older button

### Transactions

- Real-time sync from YNAB API with deletion sync
- Shared transactions (one copy per YNAB transaction, not per user)
- Filter by all, expenses, income, transfers
- Search by payee or category
- Add expense with AI auto-categorization and receipt image recognition
- Receipt photo or PDF attachment auto-fills payee and amount via Claude vision
- Auto-detect YNAB account from receipt content
- Floating action button for quick expense entry (hidden on chat page)
- Unread indicator dot when new data synced

### Budget

- YNAB-style budget page with category groups, monthly assigned amounts, activity and available
- Carryover: positive available rolls forward, overspending does not drag into the next month
- Per-category monthly targets with progress, snooze for a single month, and clear
- Inline assigned editor with a calculator popover
- Category inspector (right sheet): rename, available breakdown, target editing, hide and unhide
- Move money between categories and cover overspending from ready-to-assign or any funded category
- Cover-from popout on overspent amounts and filters for all, overspent and money available
- Drag-and-drop reorder of categories within a group and of whole groups
- Hidden categories section at the bottom to unhide
- Add categories from the topbar, today button to jump back to the current month

### Accounts

- Manage accounts without YNAB: add, edit, close and delete manual accounts
- Mark a spending account and exclude accounts from the budget
- Per-account AI notes and source badges for manual, Synci and YNAB accounts

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

### Income

- Add/edit/delete income sources
- Day 0 = last day of month
- YNAB payee matching with wildcard patterns
- Received badge when matched to YNAB transaction
- Amount history and averages
- Synci bank integration for automatic income detection

### Debts

- Auto-populated from YNAB otherDebt accounts
- Must-pay priority flag
- Editable interest rates and monthly payments
- Snowball and avalanche payoff strategies with charts
- AI debt payoff suggestion (shared cache)
- Closed account sync from YNAB

### Investments

- Auto-populated from YNAB otherAsset accounts
- Editable monthly contribution amount and expected return percentage
- Ticker tracking with Yahoo Finance and Seligson fund scraping
- Compound growth projection chart
- Monthly contributions included in dashboard month status

### Subscriptions

- Brand-styled cards with auto-detected colors and SVG logos
- Must-pay priority flag
- Monthly and yearly cost summary
- YNAB payee matching for auto-detection
- Paid/overdue status badges
- Active/inactive toggle

### Savings goals

- Target amount, saved amount, and progress bar
- Optional target date with monthly savings calculation
- Optional YNAB category linking
- AI advisor and summary are aware of all goals

### Net worth

- Snapshot history with area chart and forecast line
- 20-year projection modeling cash, investments, and debts separately
- Auto-snapshot on every YNAB sync

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
- Deduplication via synci_processed table

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
