### 2.12.0: 2026-06-05

* Add automatic local data mode that uses Dough's own data when YNAB is disconnected and YNAB when connected
* AI features (chat, summaries, debt suggestion) work without YNAB by assembling context from local data
* Hide YNAB sync buttons and the "synced from YNAB" labels when YNAB is disconnected
* Import all transactions straight to Dough via Synci with transfer auto-pairing in local mode
* Add local categories with a management UI and direct add, edit and delete of transactions
* Add an accounts page to manage accounts without YNAB, with spending and exclude-from-budget toggles
* Accounts page shows only spending accounts with drag-to-reorder and red/green balances; debts and investments live on their own pages
* Editing an account balance records a reconciliation adjustment transaction so history stays consistent
* Manage debts and investments on their own pages without YNAB: add them, edit balance, interest and contribution
* Add a YNAB-style budget page with monthly allocations, carryover, targets and per-month snooze
* Add a category inspector with inline-editable name, group and description, breakdown, target editing and hide
* Show a save confirmation toast when editing a category name, group or description
* Style the budget topbar as a darker frosted glass bar that stays readable while scrolling
* Open dialogs with a centered blur fade instead of drifting in from the corner
* Rework budget drag-and-drop: the list no longer reshuffles mid-drag, a dashed placeholder marks the drop spot
* Drag a category into another group to move it between groups
* Use the rounding epsilon for the group total colour so it matches the rows
* Count refunds and other inflows toward a category so available reflects them like YNAB
* Rewrite a category's transaction history when it is renamed so its activity is not lost
* Cap move money and cover overspending at the source category's available balance
* Base Ready to Assign on the viewed month so prior-month leftover carries forward instead of vanishing
* Use YNAB's own per-month Ready to Assign and income, adjusted for local assignment edits; fall back to a per-month income model without YNAB
* Carry Ready to Assign forward into not-yet-synced future months so budgeting next month is seamless
* Delete a category from the inspector, moving any leftover money to Ready to Assign or another category first
* Cover an overspent category before deleting it; archive categories with history and remove unused ones outright
* Delete a category group from its header, keeping its categories without a group
* Show recurring bills with the same brand colours and icons as subscriptions via a shared brand module
* Set a category target per day, week, month or year; the amount is distributed into the month's need
* Add Auto-assign on the budget page: fund to targets, copy last month's assigned, or copy last month's spending
* Add an Age of Money box to the budget topbar using YNAB's own per-month figure (synced from YNAB)
* Add an Age of Money history line chart at the bottom of the budget page, with the current month as a dashed reference
* Backfill up to twelve months of YNAB month data including age of money on sync
* Date inputs now follow the configured date format with a themed calendar picker and a dark-mode icon
* Fix the native select dropdown chevron being cramped against the right edge
* Change a transaction's category from the edit dialog (writes back to YNAB and local data)
* Make the AI model configurable per task in settings, tiered by demand
* Route categorizing through fast, cheap Gemini 2.5 Flash when a key is set (thinking disabled, ~0.4s), falling back to Haiku via the CLI
* Default demanding tasks (Dougie chat, receipt vision) to Claude Opus via the CLI, covered by the subscription
* Lower Ready to Assign when money is assigned to a future month, so budgeting ahead is reflected now
* Rename the fully-budgeted state to "Kaikki budjetoitu" and tidy the topbar sizing
* Snooze a category for the month into a collapsible snoozed group; its target stops counting that month
* Add move money and cover overspending between categories
* Add drag-and-drop reorder for categories and whole groups in the budget view
* Make the budget page usable on small mobile screens (320-540px)
* Pull category groups from YNAB and backfill them onto local categories
* Seed local monthly assigned amounts from YNAB allocations so the budget page reflects YNAB on cutover
* Add overspent and money-available filters with a cover-from popout on overspent amounts
* Click a category's activity amount to see the transactions behind it
* Load the transactions list with infinite scroll instead of rendering every row at once
* Restore visible keyboard focus rings for interactive elements and make transaction rows keyboard-operable
* Add a configurable date and time format setting and apply it to date labels
* Apply the app background gradient to the login screen
* Fix YNAB settings migration resurrecting a disconnected token

### 2.11.0: 2026-05-29

* Add household setting to hide AI summaries and debt suggestion everywhere via settings toggle

### 2.10.0: 2026-05-29

* Add automatic daily YNAB sync via cron with a configurable hour setting, default 6

### 2.9.0: 2026-05-27

* Add hide button on AI summary cards to mark individual summaries hidden in the shared database

### 2.8.0: 2026-05-22

* Add manual received and not-received toggle for income that overrides auto-match
* Recompute tomorrow budget from money actually left instead of spreading today's spend
* Show notice when daily budget falls below tight threshold with a button to the relevant settings

### 2.7.0: 2026-04-29

* Add per-income target account override so Synci routes income to the chosen YNAB account regardless of which bank account the deposit lands in

### 2.6.2: 2026-04-29

* Fix month status projection to use spent-so-far plus remaining instead of double counting bills and full month discretionary average

### 2.6.1: 2026-04-29

* Lock past day chart colors to earliest known snapshot when no per-day snapshot exists

### 2.6.0: 2026-04-27

* Add toggle to reserve next month's saving goal on payday when largest paycheck is at end of month
* Skip proportional saving deduction in next month when last cycle already reserved it
* Wire reservation through Dougie so chat advice matches dashboard math

### 2.5.8: 2026-04-20

* Snapshot discretionary target per day so past chart colors stop drifting
* Count bills as paid only when actually paid, not when due day has passed
* Dougie uses priority bills and debts in without-bills mode to match dashboard
* Dougie no longer states the daily budget is 0 euros when reservations compress it to zero

### 2.5.7: 2026-04-19

* Clamp due day to last day of month so day 31 incomes/bills work in shorter months

### 2.5.6: 2026-04-17

* Stop reserving obligations from current balance when upcoming income covers them

### 2.5.5: 2026-04-16

* Use real BookBeat serif B logo from brand wordmark

### 2.5.4: 2026-04-16

* Add BookBeat brand config with lilac color

### 2.5.3: 2026-04-11

* Fix 14-day budget window extending past intended range causing 0 budget
* Add pattern delete buttons to subscriptions and income pages

### 2.5.2: 2026-04-08

* Green border and checkmark overlay on past success days in savings streak

### 2.5.1: 2026-04-06

* Add No-IP brand config and traced SVG icon

### 2.5.0: 2026-04-06

* Spending trends compare same day of month between calendar months

### 2.4.0: 2026-04-05

* Add trends API endpoint with rolling 30-day comparison from local transactions DB

### 2.3.0: 2026-04-02

* Replace segment-based budget with rolling 14-day window using current balance only
* No future income projected in daily budget, recalculates when income arrives
* Proportional savings deduction based on window length
* Budget tooltip shows balance, window, must-pay, savings, upcoming bills, and with-bills budget
* Update Dougie and AI summary prompts for rolling window approach
* Dougie gets income timeline and conservative advice based on current balance
* Dougie knows about must-pay priority flags on bills, subscriptions, and debts
* Show total unpaid and must-pay amounts in Dougie context
* Add conservative advice rules to Dougie system prompt
* Add NextDNS brand config and SVG icon
* Exclude fixed costs (bills, debts, investments) from Dougie todaySpent
* Show today's fixed costs separately in Dougie context
* Only apply nowrap to short euro amounts in chat, not long bold headings

### 2.2.0: 2026-04-02

* Add must-pay priority flag to bills, subscriptions, and debts
* Priority items always included in budget calculation regardless of auto mode
* Priority toggle button in bill, subscription, and debt edit views
* Priority indicator icon in bill and subscription lists
* Show all unpaid bills total in daily budget note, consistent with Erääntyviä laskuja card
* Fix obligations text inline without line break
* Fix priority icon alignment for multi-line titles on mobile
* Add gap for debt priority button on mobile
* Show red dot and cross in savings streak when over budget
* Update streak message when over budget
* Fix spending flow chart start-of-month bubble clipping

### 2.1.0: 2026-04-01

* Migrate transactions to shared: one copy per YNAB transaction regardless of user
* Remove per-user duplicate transactions from database

### 2.0.3: 2026-04-01

* Sync transaction deletions from YNAB to Dough for all users
* Preserve all historical transactions, only check current month for deletions

### 2.0.2: 2026-04-01

* Fix spending flow chart left margin offset causing clipping
* Set spending flow overflow visible on all devices
* Add first-day dot position transform
* Use emoji flames in savings streak with greyscale for older days

### 2.0.1: 2026-03-31

* AI summary reads from local transactions DB for consistency with dashboard
* Use actual received income when higher than expected in AI summary
* Convert cross-month segment days to real dates in budget tooltip

### 2.0.0: 2026-03-31

* Budget calculation spans to next income across month boundary
* Exclude bill, debt and investment payments from daily budget spending
* Show upcoming obligations total with tooltip in daily budget note
* Bills, next income and bill count wrap to next month when current month is done
* Fix month estimate double-counting debt and investment payments
* AI summary includes next month obligations and fixes double-counting
* Share AI summary and debt suggestion cache across all household users
* Fix Finnish relative time in AI summary age display
* Synci income creates real YNAB transaction with proper ID and updates account balance
* Change "tilipäivään" to "seuraavaan rahapäivään"
* Fix Dougie daysUntilIncome and tomorrowBudget to span across months

### 1.13.0: 2026-03-31

* Synci sync only marks matched income as received in Dough, no direct YNAB creation
* Add deduplication for Synci transactions
* Automatic Synci income polling every 30 minutes

### 1.12.2: 2026-03-30

* Flip spending flow tooltip bubble to left side on mobile when near end of month
* Fix spending flow bubble clipping on desktop by allowing SVG overflow
* Fix mobile PWA topbar overlapping with iOS safe area
* Add grinning face emoji to chat reactions
* Show relative time since AI summary was fetched next to icon
* Fix Safari mobile auto-zoom on chat textarea focus
* Show who spent each transaction in Dougie context

### 1.12.1: 2026-03-29

* Sync closed account status from YNAB, hide closed accounts from settings and AI
* Fix duplicate transactions in heatmap and AI context when multiple users sync same YNAB budget

### 1.12.0: 2026-03-28

* Chat attachments are read-only by default, expense adding requires "lisää kulu" or "add expense"
* Smart account detection from receipts via AI matching to exact YNAB account names
* Fix chat loading indicator stuck forever when returning to chat
* Hero note reacts to remaining budget: different message when nearly used up vs plenty left
* Use past tense "oli" for today's budget when spending has occurred

### 1.11.2: 2026-03-28

* Redesign chat input: compact textarea with inline attach/expand buttons
* Fix textarea and send button vertical alignment
* Inline buttons stay pinned to top when textarea grows

### 1.11.1: 2026-03-27

* Add today's spending, remaining budget and tomorrow's budget to Dougie context
* Calculate today's spending from all transactions, not just last 10
* Reduce Dougie addressing user by name every message
* Dougie sees message reactions and who reacted
* Dougie reads all data from local DB for real-time accuracy
* Auto-trigger YNAB sync if cache is older than 2 hours when chatting

### 1.11.0: 2026-03-27

* Add Synci API integration for automatic bank income sync to YNAB
* Fetch bank accounts from Synci API with account-to-YNAB mapping in settings
* Poll mapped accounts for income transactions and create YNAB entries
* Income matched via payee patterns is marked as received in Dough
* Redesign savings streak card with flame icon matching other metric cards
* Show 7 days in savings streak
* Name the AI advisor Dougie, show in menu and chat bubbles
* Prevent amounts from breaking across lines in chat messages
* Fix typing indicator prepending bot name to user name
* Fix chat textarea scrollbar on mobile, auto-expand on input
* Add expand/collapse button for full-size chat input
* Increase chat sender name font size
* Add emoji reactions to chat messages with real-time sync
* Position reaction picker at top right of message bubble
* Improve reaction badge styling and hover states
* Add Slack-style tooltip showing who reacted with each emoji
* Heatmap updates in real time when expenses are added or synced
* Show all household transactions in heatmap, not just current user

### 1.9.4: 2026-03-25

* Show "Huomenna tulee rahaa" when 1 day until income instead of "1 päivää tilipäivään"
* Use period separator instead of center dot for income countdown
* Fix FAB add expense button not hiding on AI advisor page due to CSS specificity
* End heatmap at today instead of showing empty future squares

### 1.9.3: 2026-03-24

* Always show tomorrow's budget in daily allowance hero note
* Tomorrow's budget respects current bill inclusion setting

### 1.9.2: 2026-03-24

* Remove green square logic and today border from heatmap
* Use 90th percentile scaling for heatmap so rent does not wash out other days

### 1.9.1: 2026-03-24

* Replace app icon with donut chart icon, white on black with proper padding

### 1.9.0: 2026-03-24

* Add spending heatmap with 44 weeks of history, scrollable on mobile
* Add spending trends component showing daily category trend fact with percentage change
* Fetch and store 10 months of transaction history for heatmap
* Fix font-weight inheritance on daily allowance hero note numbers

### 1.8.3: 2026-03-24

* Show upcoming income as dashed striped bar on top of actual income in monthly cash flow chart
* Show 5 months in cash flow chart instead of 4
* Round top corners on income bars when no upcoming income is stacked
* Backfill monthly snapshots up to 5 months instead of 3
* Show 8 days in savings streak instead of 7
* Fix dialog form-stack having stray box-shadow and font-size rules
* Move account name closer to attach button in add expense dialog

### 1.8.2: 2026-03-24

* Add floating action button to add expenses from any page with full receipt/batch support
* Extract add expense dialog into shared DRY component used by both FAB and transactions page
* Hidden on transactions page which has its own add button

### 1.8.1: 2026-03-24

* Show current balance and days in daily budget tooltip alongside tightest segment
* Hide X axis from spending flow and net worth top charts for minimal look

### 1.8.0: 2026-03-24

* Fix net worth projection with correct component model tracking cash, investments, and debts separately
* Use snowball debt payoff matching Velat tab logic for net worth forecast
* Show actual years on net worth projection X axis, default to 10 year view
* Add breathing room and money timeline rules to AI advisor
* Apply bills inclusion setting to AI chat, summary, and daily budget consistently
* Fix tooltip font-weight inheritance from parent elements

### 1.7.4: 2026-03-23

* Fix bill auto-matching to not match previous month late payments as current month
* Respect manual paid/unpaid overrides in AI chat and summary context
* Distinguish bills from auto-charged subscriptions in AI context
* Add reasoning requirement to AI default guidelines
* Make investment chart color always reflect daily change

### 1.7.3: 2026-03-23

* Show excluded flag on accounts in AI context so advisor considers all accounts
* Increase form-stack gap, fix settings-account-list margin

### 1.7.2: 2026-03-23

* Make investment ticker chart color always reflect daily change
* Remove 24h TTL from AI summaries, cache forever until explicit refresh
* Add period to debt AI suggestion prompt text

### 1.7.1: 2026-03-23

* Add auto mode for bills in daily budget: includes bills when balance covers them, excludes when it does not

### 1.7.0: 2026-03-23

* Add savings streak tracker with animated fire/cross indicators for last 7 days
* Store daily budget and spending history in SQLite for accurate streak tracking
* Add configurable budget thresholds (tight/normal/good) with splurge warning in settings
* Add net worth growth projection with debt payoff, savings, and investment compound returns
* Add 5y/10y/20y range selector to net worth projection chart
* Add white-space nowrap to all formatted amounts to prevent orphaned currency
* Replace minimum daily budget with bills inclusion toggle for daily budget calculation

### 1.6.3: 2026-03-23

* Add bills inclusion toggle in settings under own daily budget card
* Show bill impact on daily budget when bills excluded
* Show total budget as first line in hero note
* Fix spending flow bubble using targetPerDay for over/under when dailyBudget is 0
* Fix daily budget double-counting overdue bills already reflected in account balance
* Fix double dot in hero note, remove em-dashes from dashboard text
* Fix decimal_places API passthrough
* Fix hero card tooltip clipping with overflow visible
* Link Dough logo to dashboard
* Emit SSE event on settings change so dashboard updates without page reload

### 1.6.2: 2026-03-23

* Add account exclusion from daily budget and available balance in settings
* Excluded accounts still count toward net worth but not daily spending calculations

### 1.6.1: 2026-03-23

* Add transaction edit modal with click-to-edit payee, amount, date, account, memo
* Save transaction edits to both local SQLite and YNAB API
* Fix cash flow chart using expected income instead of actual for current month
* Fix doubled transaction data caused by multi-user sync deduplication
* Fix CSS class collision between bill list-item and investment edit-item
* Auto-refresh transactions page on SSE events from other users
* Show AI thinking animation when returning to chat with pending response
* Move drag handle to right side after amount

### 1.6.0: 2026-03-23

* Add ticker field to investment overrides for linking accounts to stock/index symbols
* Add ticker API with Yahoo Finance scraping and 15-minute SQLite cache, all-time monthly data for MAX
* Show live stock price, daily change, and interactive chart per investment with 1W/6M/MAX range filter
* Add Seligson fund scraping with proxy chart data from related indexes
* Add drag-and-drop reordering of investment accounts with saved order
* Auto-calculate return % from ticker data when available
* Add investment projection chart and summary to net worth page
* Add notes to all three investment summary cards
* Serve investment data from SQLite instead of legacy JSON cache
* Fix Finnish typing indicator, separate typing and thinking translations
* Add no em-dash rule to AI chat default guidelines
* Show family spending in greeting even when personal spending is zero
* Always show savings amount in green in greeting
* Fix transaction unread indicator triggering from own transactions
* Rename debt-item/debt-edit CSS to generic list-item/list-edit for DRY consistency
* Add drag-and-drop reordering to debts list
* Enforce no em-dash rule in AI system prompt, not just guidelines
* Add weekday, day of month, and days remaining to AI chat and summary context
* Show AI thinking animation when returning to chat with pending response
* Auto-refresh transactions page on SSE events from other users
* Fix doubled transaction data caused by multi-user sync deduplication
* Fix CSS class collision between bill list-item and investment edit-item
* Move drag handle to right side after amount
* Add transaction edit modal with click-to-edit payee, amount, date, account, memo
* Save transaction edits to both local SQLite and YNAB API
* Fix cash flow chart using expected income instead of actual for current month
* Always show savings amount in green in greeting

### 1.5.4: 2026-03-23

* Cap personal budget suggestion at family remaining so it never exceeds available
* Persist new transactions to local SQLite immediately so all users see them without sync
* Refresh YNAB cache from SQLite on data changes so dashboard updates for all household members
* Hide zero spending from greeting, show savings message when something is spent
* Improve Finnish greeting wording

### 1.5.3: 2026-03-23

* Redesign net worth page with change summary, dynamic gradient chart, forecast line, and zero reference
* Move net worth to second position in sidebar navigation

### 1.5.2: 2026-03-23

* Add over/under diff as first item in spending flow chart tooltip
* Reorder spending chart tooltip: spent first, savings target second
* Reduce savings target dashed line opacity to 50%

### 1.5.1: 2026-03-23

* Fix mobile Safari chat zoom by setting textarea font-size to 16px
* Fix horizontal scroll in chat by adding overflow-x hidden
* Add chat pagination with load older button, show only current day by default
* Show most recent day's messages when no messages exist for today

### 1.5.0: 2026-03-22

* Persist YNAB transactions, accounts, month budget and categories to local SQLite on sync
* Serve all YNAB data from local database instead of API calls, minimizing rate limit usage
* Store YNAB category IDs locally for offline AI auto-categorization
* Only the sync button and budget list hit the YNAB API, everything else reads from cache
* Fix transaction upsert failing on partial unique index, always write legacy cache as fallback
* Fix sync button requiring double tap on mobile by clearing throttle on explicit press
* Fix sync relative time not updating after sync by reading syncedAt from data

### 1.4.1: 2026-03-22

* Rewrite daily budget as segment-based cash flow between income events, no salary assumption
* Fix daily budget using start-of-day balance so overspend carries forward to future days
* Fix AI seeing paid subscriptions as overdue by checking subscription payee matches
* Add budget calculation breakdown tooltip to daily budget hero card

### 1.4.0: 2026-03-22

* Show sidebar collapse as inline button when expanded, overlay on logo hover when collapsed
* Speed up sidebar collapse transition
* Pre-populate AI prompt fields with default instructions instead of empty placeholder
* Move sidebar collapse button to logo header area on desktop
* Hide chart Y-axis tick labels in privacy mode using mask() on all chart tickFormatters
* Remove must/want priority from savings goals, all goals are now equal
* Add markdown table rendering in AI chat and summary via remark-gfm
* Add F component for all euro amounts with styled tooltip showing exact value when decimals are 0, across all pages
* Add search cancel button to transactions search field
* Add inline edit and delete for payee match patterns with min/max amount fields in bills
* Show max 5 recent transactions on dashboard
* Show exact amount tooltip on hover when decimal places is 0 for dashboard metric values
* Privacy mode: hide chart axis numbers, obfuscate days until income, trend %, dates, counts, and chart tooltips
* Add Ultra.cc brand icon and subscription entry
* Add checking+savings card to net worth page
* Fix tanaan to tänään in date-utils

### 1.3.0: 2026-03-21
* Extract correct dates from receipt images: handle relative dates (Tänään, Eilen), grouped headings, Finnish date formats
* Pass transaction dates to YNAB in both batch add and chat auto-add
* Redesign expense modal: multi-transaction batch view from receipts, per-transaction account selection, title case payee normalization
* Make dialog content scrollable when taller than viewport on small devices
* Add Claude (Anthropic) and Apple iCloud brand icons and colors to subscriptions
* Extract account name from receipt images for YNAB account routing, fall back to user default
* Support multiple transactions from single receipt/image in both chat and expense modal
* Match mobile chat textarea height to stacked button height
* Add official Netflix and Spotify SVG brand icons to subscriptions
* Set autoComplete off on all inputs by default to prevent password manager popups
* Add amount range (min/max) to payee matching for distinguishing same-payee different-amount bills/incomes
* Add subscriptions page with brand-styled cards, payee matching, paid/overdue detection
* Include subscriptions in dashboard calculations, daily budget, month status, and AI context
* Add payee matching to income edit dialog (same as bills)
* Show PDF preview in both expense modal and AI chat instead of just a badge
* Always show days until next income in hero card note
* Increase personal greeting text to 18px
* Only show transaction indicator for expenses added by other users
* Move chat attach button next to send button, stack vertically on mobile
* Add desktop chat margin top and bottom with adjusted viewport height
* Add account notes in settings for AI context (e.g. "buffer account", "emergency fund")
* Pass account names, balances, and notes to AI chat and summary
* Fix PDF upload: use document content type instead of image for application/pdf
* Exclude bill payments from today's spending so they don't reduce "tänään jäljellä" (already in daily budget simulation)
* Add savings goals page with must-have/want-to-have priorities, progress tracking, YNAB category linking, and include/exclude toggle
* Pass savings goals to AI chat and summary for context-aware advice
* Fix privacy mode: digits replaced with bullet chars via fmt(), summary shown as skeleton lines, € symbol preserved
* Scope all button hover styles behind @media (hover: hover) to prevent sticky states on mobile
* Remove all focus outlines and rings globally to prevent sticky highlights after tap
* Add privacy mode toggle (eye icon) in topbar and sidebar to mask all sensitive data for screenshots
* Cache debt AI suggestion to DB for 24 hours, load on page mount
* Fix debt AI suggestion refresh button margin with ai-summary-actions wrapper
* Add white-space nowrap to AI summary and chat amounts to prevent orphan € symbol
* Require due day for debt overrides, disable save without it, skip due_day=0 in all calculations
* Fix daily budget cash flow: obligations due on/after salary day are covered by salary, skip debts without due date. Extracted shared calculateDailyBudget helper (DRY)
* Apply time-window cash flow simulation to dashboard, AI chat, AI summary, and spending flow chart

### 1.1.0: 2026-03-20

* Make Kuukauden tilanne info tooltip work on mobile tap
* Add white-space nowrap to all euro amount elements to prevent orphan € on own line
* Fix spending flow chart and spending chart to show discretionary spending only (excluding bills/debts/investments)
* Fix daily budget to subtract unpaid bills, debt payments, and investments from balance before dividing by days
* Force Claude Opus model for all AI features (chat, summary, debts, categorization, receipt parsing)
* Fix greeting to hide household remaining when same as personal, fix label to "jäljellä"
* Add blur glass effect to mobile top bar with backdrop-filter
* Tint dark theme backgrounds with subtle deep purple-black
* Fix AI chat messages not appearing by adding fetch response fallback with dedup
* Remove chat page heading, make chat full height with margins
* Reduce spending flow circle size, adjust tooltip position
* Add info tooltip to "Kuukauden tilanne" card explaining the calculation
* Add due day field to debt overrides, show in debts page, pass to AI chat, summary, and debt suggestion
* Fix chat image thumbnails not loading from DB when revisiting chat
* Fix AI to naturally confirm added expenses instead of saying it cannot add them
* Trigger YNAB sync after adding expense from chat so it shows in dashboard
* Fix mobile chat height to account for topbar
* Remove gap from AI summary action buttons
* Increase spending flow dashed line opacity slightly for better visibility
* Add PDF support for receipt uploads in both expense modal and AI chat
* Auto-add expense to YNAB when image is sent in AI chat
* Show uploaded image thumbnail in chat message bubbles, persisted to DB
* Fix AI daily budget to match dashboard, keep after-bills number as secondary context for affordability questions
* Include today's expected income in daily spendable calculation, skip already-matched income
* Fix add expense button style consistency, remove AI category help text from modal
* Dim green target and grey projection dashed lines in spending flow chart
* Fix dashboard grid: month status span 2, other metric cards each 1 column on desktop
* Add receipt image recognition via Claude CLI to expense modal with auto-fill payee and amount
* Add image attachment to AI chat for receipt/document analysis
* Auto-detect YNAB account from user profile, remove account dropdown from expense modal
* Add name-based account routing: memo mentioning another user routes to their account
* Move sync button to left of add expense button, make button style consistent with other pages
* Fix mark unpaid button to override YNAB auto-match by storing explicit is_paid=0
* Add spending flow hero chart with gradient line, projected spending, savings target, and status bubble
* Change savings target label to "Vakaa talous" in Finnish
* Add monthly snapshots table for historical spending data, backfill 3 months on first sync
* Replace spending chart budget line with green savings target dashed line
* Show 4 months in cash flow chart (current + 3 historical)
* Pass monthly history to AI summary and chat for month-over-month comparisons
* Remove right padding on AI summary last action icon
* Move personal budget share to per-user profile setting so each user can have their own %
* Show suggested personal amount and household remaining in greeting
* Fix bills due card to include overdue unpaid bills, not just future ones
* Add comprehensive README.md with install guide, architecture, contributing, and documentation links
* Pre-calculate available-before-payday and daily spendable in AI chat to prevent treating future salary as available
* Align AI summary calculations with dashboard: saving goal in daily budget, debt/investment payments in expenses, matching discretionary rounding
* Add global decimal places setting (0-2) in settings, default 0 for whole euros
* Strip markdown formatting from copied text in AI summary and chat
* Fix Y-axis clipping on all charts by removing negative left margin and widening axis
* Add copy button on AI advisor assistant bubbles
* Add investments, debt details, and savings goal to AI chat, summary, and debt suggestion prompts
* Include debt installments in month status expense projection
* Move month status card right after hero, before available balance
* Add investments page pulling accounts from YNAB with editable monthly contribution and return %, compound growth projection chart
* Include investment monthly contributions in dashboard month status calculation
* Color income green and expenses red in month status sub label
* Fix month status projection to separate bills from discretionary spending

### 1.0.0: 2026-03-19

* Change bill due text to "Erääntyy X. päivä" in Finnish
* Fix greeting value colors to only apply to euro amounts
* Align sidebar collapse button to left
* Show euro coin favicon when sidebar is collapsed
* Show YNAB error message on dashboard instead of generic connect prompt
* Fix transaction unread indicator to only trigger on manual expense adds
* Fix SSE circular reference error
* Show 0 in hero when overspent with colored note amounts
* Fix Y-axis with k suffix for thousands
* Remove hover background change on cash flow card
* Fix income edit button order (Poista left, Tallenna right)
* Add month status reasoning with income and projected expenses
* Add comprehensive documentation: setup guide, features, API reference
* Update architecture docs with database tables, data flow, AI integration
* Add manual paid/unpaid toggle button on bills (circle checkmark)
* Show actual vs expected amount diff when paid amount differs from bill amount
* Store manual paid status per bill per month in bill_manual_status table
* Emit SSE events from income API for real-time dashboard updates
* Add AI auto-categorization for added expenses via Claude CLI
* Add description/memo field to expense form
* Add categories API for YNAB category list
* Merge hero card today spent and remaining into single line
* Add unread indicator dot on transactions sidebar when data changes
* Fix Finnish: "Kuukausitulot", "Näkyy tilillä", "Suurimmat kuluerät", "perhe yhteensä"
* Remove "guaranteed recurring" card from income page, keep single total
* Add income amount history tracking for variable income averages
* Show average amount on income list when 2+ months of history exist
* Remove recurring badge from income list items
* Fix dashboard grid by moving today remaining into hero card
* Remove hardcoded home directory path from claude CLI fallback
* Fix Finnish translations: "Varma kuukausitulo", "perhe yhteensä", "Suurimmat kuluerät"
* Add CLAUDE_PATH to env example
* Audit and clean sensitive data for open source readiness
* Make income, bills, net worth shared across all household users
* Remove user_id filters from income, bills, net worth API queries
* Fix chat clear to delete all shared messages
* Fix AI summary and chat to use all household income and bills
* Fix settings input width to fill available space
* Add "Today remaining" card showing daily budget minus all household spending
* Fix personal greeting to show personal + household spending separately
* Daily budget remaining subtracts ALL household spending, not just personal
* Bold and colorize monetary amounts in AI chat with indigo
* Use comma decimal separator in all AI prompts
* Fix AI to not mislead about income timing (salary at end of month)
* Fix metric card value font sizes to be consistent across all dashboard cards
* Fix AI advisor by removing unsupported --no-input flag from claude CLI call
* Make category breakdown pie chart larger (200px, bigger radii)
* Replace burger menu icon with PanelLeft for modern look
* Reduce mobile page padding for better space usage
* Align mobile top bar button more to the left
* Fix transaction amount spacing (remove space between sign and number)
* Remove all hardcoded demo data from bills, income and debts pages
* Add AI financial summary to dashboard with daily cache and manual refresh
* Support both English and Finnish summaries stored separately
* Fix euro sign rendering as \u20AC escape in chart tooltips and page components
* Add persistent chat messages saved to SQLite database
* Load chat history on page mount, save new messages automatically
* Add clear chat button with trash icon
* Fix pie chart legend overlap by adding gap, truncation and nowrap on amounts
* Make pie chart larger on mobile (220px)
* Increase legend amount font weight to 600
* Fix spending chart by filtering out transfer transactions between accounts
* Fix spending chart Y-axis width to prevent truncated labels
* Fix spending chart budget line to use actual spending pace instead of inflated total
* Add global .icon-sm utility class for consistent small icon sizing
* Fix Finnish translation for bills still due ("Erääntyy ennen kuun loppua")
* Fix Finnish debt subtitle ("Seuraa ja lyhennä velkojasi")
* Normalize all currency values to xxxxx.xx € format across all pages
* Fix NaN% in debts progress when no debts exist
* Sync debts from YNAB otherDebt type accounts automatically
* Add sync button and relative last sync time to dashboard header
* Make pie chart fill container (320px max, radii 85/140)
* Move sync time next to button in compact format
* Add net worth section to dashboard with investments, accounts and debts breakdown
* Add investment account list from YNAB otherAsset accounts
* Add netWorth, accounts, investments i18n keys for EN and FI
* Replace chat spinner with bouncing dots typing indicator
* Remove chat clear/trash button
* Don't save error messages to chat history
* Add polling so AI response persists even if you navigate away
* Save AI chat responses to database server-side for reliability
* Increase claude CLI timeout to 120 seconds for both chat and summary
* Switch from Outfit+Inter to Geist font family for modern 2026 aesthetic
* Update color palette to indigo/violet primary with deeper dark theme
* Add glassmorphism card styling with backdrop blur and subtle borders
* Add tabular-nums and tighter letter-spacing on all metric values
* Update all chart colors to match new palette
* Update login page to use new theme tokens and cleaner styling
* Fix AI chat and summary by piping prompts via stdin instead of CLI arguments
* Fix pie chart category rendering with fixed donut container dimensions
* Redesign to 2026 minimal aesthetic inspired by Linear/copilot.money
* Remove all icon background boxes, use bare colored icons everywhere
* Remove visible card borders, use transparent/glass backgrounds
* Make daily budget hero number larger (3.5rem desktop) with tighter letter-spacing
* Add uppercase small-caps labels with letter-spacing on all section headings
* Add tabular-nums and font-variant-numeric across all metric values
* Make legend dots square (2px radius) instead of circles
* Reduce all mobile card padding for tighter layout
* Update page headings to be larger and bolder
* Simplify button hover to subtle glow instead of complex inset shadows
* Filter transfers from income calculations in dashboard, chat and AI summary
* Add copy-to-clipboard button on AI summary card
* Fix duplicate net worth heading, follow hero design pattern
* Fix Finnish translation "Tulonlähteet"
* Add net worth page with snapshot history and area chart
* Add net worth nav item to sidebar
* Add net_worth_snapshots table to database
* Format debt-free time as Xv Xkk when over 12 months
* Fix cash flow chart Y-axis width to prevent truncated labels
* Fix net worth hero value line-height and spacing
* Wire income sources page to SQLite with CRUD API
* Add burn rate metric (daily spending rate) to dashboard
* Add projected month-end balance to dashboard
* Improve AI summary with burn rate, projected balance, and living-above-means detection
* Fix income page to load from database and persist form submissions
* Separate user settings (language) from household settings (YNAB, saving rate)
* Add household_settings table for shared settings between users
* Migrate YNAB credentials from user table to household settings automatically
* Add saving rate setting with monthly goal deducted from daily budget calculation
* Add transfer filter and yellow badge to transactions page
* Hide transfers from "all" view, show with dedicated filter button
* Auto-take net worth snapshot on every YNAB sync
* Fix spending chart Y-axis width and margins
* Enhance debts page with live YNAB data, editable interest rates and payments
* Add debt_overrides table for manual interest rate and payment adjustments
* Add AI debt payoff suggestion with refresh button
* Show YNAB monthly targets and actual payments per debt
* Fix logout by using window.location.replace
* Fix AI summary refresh button with type="button" and Safari clipboard fallback
* Fix global focus ring to use indigo instead of white
* Enlarge AI summary button tap targets
* Add YNAB payee matching system for income sources
* Support multiple payee patterns per income source (regex supported)
* Auto-match transactions to income sources on YNAB sync
* Show green "Received" badge on matched income sources
* Skip already-received income from upcoming calculations on dashboard
* Add link button to income list items for managing payee patterns
* Add payee_matches and monthly_matches tables
* Add household profile setting for AI context (family size, kids, etc)
* Feed household profile to all AI prompts (summary, chat, debt suggestion)
* Treat "Starting Balance" and "Reconciliation Balance Adjustment" as transfers
* Extract shared isTransfer helper to transaction-utils.ts
* Fix household profile save button with explicit type="button"
* Feed recurring bills and due dates to AI summary and chat prompts
* Remove debt details from default household profile placeholder
* Add inline editing for income sources (name, amount, day)
* Add delete button for income sources
* Support day 0 as "last day of month" for income expected date
* Update income API PUT to support full field editing
* Relax expected_day constraint to allow 0
* Move all AI prompts to editable settings stored in DB
* Add AI prompts section in settings with chat, summary and debt instruction editors
* Clear field to restore default prompt
* Fix income list layout with separate toolbar row for edit/link/delete buttons
* Fix all remaining white focus rings with global !important override
* Add "Lisää puuttuva kulu" button to transactions page for adding expenses to YNAB
* Add YNAB accounts API for account selector dropdown
* Fix duplicate AI chat messages by removing client-side assistant message save
* Reduce Y-axis width and left margin on all charts for tighter left alignment
* Remove duplicate net worth title on net worth page
* Add markdown rendering for AI chat assistant messages
* Fix chat scroll overflow with min-height: 0 on messages area
* Filter transfers from dashboard recent transactions widget
* Fix debt list color showing green instead of red on dashboard
* Fix net worth chart Y-axis to show negative values with wider width
* Fix chat scroll-to-bottom on load
* Clear duplicate chat messages
* Add SSE (Server-Sent Events) real-time system for instant updates across all clients
* Add in-memory EventBus singleton for broadcasting events between API routes and SSE connections
* Add useEvent hook for subscribing to SSE events from any component
* Replace chat polling with SSE for instant message delivery
* Replace sidebar unread polling with SSE event-driven counter
* Add SSE listeners to YNAB context for auto-refresh when any user syncs
* Broadcast chat messages, typing indicators, sync completions, and data updates via SSE
* Add real-time documentation in docs/real-time.md
* Differentiate chat bubbles: self (right, solid), other user (left, warm amber), AI (left, cool neutral)
* Show sender name only on other users' bubbles, not on own
* Overhaul bills with overdue detection, paid status from YNAB matching, and amount history
* Show "Myöhässä" badge when bill due date has passed without matching YNAB transaction
* Show "Maksettu" badge when bill is matched to YNAB transaction this month
* Show average amount below bill amount when 2+ months of history exist
* Add tap-to-edit on bills with name, amount, due day, category, and payee matching
* Track bill amount changes in bill_amount_history table for averages
* Feed bill paid/overdue status to AI summary and chat advisor
* Add list-item-body grid layout with 4px gap
* Bills page auto-refreshes via SSE on data changes
* Add name field to user profile settings
* Add linked accounts selection (checkboxes for YNAB accounts)
* Add household size setting for personal budget calculation
* Add personalized greeting on dashboard with today's spending and personal budget
* Add profile API for name and linked accounts management
* Fix AI summary to not mislead about income vs expenses when salary comes late in month
* Fix chat paragraph spacing (0.25rem instead of 0.5rem)
* Fix chat avatar border-radius to match bubble (1rem)
* Fix AI typing indicator avatar to use correct data-type attribute
* Fix match pattern input sizing and remove extra padding-left

### 0.2.0: 2026-03-18

* Replace Tailwind CSS with custom SMACSS-derivative CSS framework
* Create theme, base, animations, state, layout foundation CSS files
* Create CSS modules for all 17 UI components
* Create CSS modules for dashboard, chat, and page components
* Migrate app-shell and sidebar to semantic `.l-` layout classes
* Migrate all UI components from Tailwind utility classes to module CSS
* Remove CVA (class-variance-authority), use `data-variant` and `data-size` attributes
* Simplify `cn()` utility to use `clsx` only, remove `tailwind-merge`
* Migrate all page components (dashboard, transactions, bills, income, debts, settings, chat) to custom CSS
* Extract login styles from globals.css to `modules/login.css`
* Remove globals.css, Tailwind PostCSS plugin, components.json
* Uninstall `tailwindcss`, `@tailwindcss/postcss`, `tailwind-merge`, `tw-animate-css`, `shadcn`, `class-variance-authority`
* Fix login form on Safari iOS by using uncontrolled inputs with FormData to handle autofill
* Fix Safari iOS login redirect by using window.location instead of router.push
* Fix Safari iOS cookie not persisting by removing Secure flag (HTTPS handled by Cloudflare tunnel)
* Add mobile responsive layout with hamburger menu and off-canvas sidebar
* Make all page grids, dashboard cards, lists, and charts stack on mobile
* Reduce padding and hide list icons on small screens for better space usage
* Make category breakdown legend stack below donut on mobile
* Add iOS safe area viewport-fit and tap highlight removal
* Fix CSS specificity for card, badge, input, and button overrides using compound selectors
* Fix YNAB settings to show budget ID field when connected
* Add disconnect YNAB button in settings
* Add `ynab_budget_id` to session user profile
* Fix update API to handle clearing YNAB token and budget ID
* Remove all static inline styles, replace with CSS classes per CLAUDE.md rules
* Add architecture and CSS framework documentation
* Fix mobile proportions: increase card padding, hero text size, list item spacing, show list icons on mobile
* Complete Finnish translations for all page components, dashboard, chat, settings, and UI labels
* Add ~60 new translation keys covering bills, income, debts, settings, chat errors, and dashboard labels
* Add proper CSS reset for buttons, inputs, headings (missing from Tailwind Preflight replacement)
* Increase button, input, and select sizes for better touch targets
* Increase metric card value font size from 1.5rem to 1.75rem
* Fix sidebar logout button rendering as white by resetting native button styles
* Wire real YNAB data to dashboard replacing all demo data
* Wire real YNAB data to transactions page
* Add YNAB context provider for shared data across all pages
* Add auto-sync on app load when YNAB is connected
* Show relative dates on transactions (today, yesterday, 3 days ago)
* Rewrite YNAB client to use REST API directly for reliability
* Fix available balance to show checking+savings total instead of YNAB toBeBudgeted
* Fix AI chat by resolving claude CLI path and wiring real YNAB data as context
* Remove all hardcoded demo data from chat API route
* Fix daily budget to use checking+savings balance instead of YNAB toBeBudgeted
* Unify metric card value font sizes across mobile and desktop
* Replace dollar sign favicon with euro coin icon

### 0.1.0: 2026-03-18

* Wire i18n locale context so language switch updates sidebar and all page headings live
* Add YNAB budget ID field to settings page
* Load user settings from database on page load so they persist across refreshes
* Wire sync now button to call YNAB sync API with user's token
* Fix card gap between header and content in settings cards
* Add copilot.money style button hover effects with glow and scale
* Fix manifest.json redirect by excluding static files from auth middleware
* Fix chart width/height warnings with mounted check wrapper
* Fix cash flow chart tooltip cursor for dark theme
* Wire YNAB connect button to save token to user profile
* Wire language select to persist preference
* Remove display name field from settings
* Use sentence case for all headings and labels
* Use European style euro format with space before sign
* Remove comma thousand separators from numbers
* Make settings card headings more compact
* Add user profile update API endpoint
* Fix better-sqlite3 Node version mismatch by pinning systemd service to nvm Node v22
* Add better-sqlite3 to serverExternalPackages in next.config.ts
* Add Outfit font for headings, Inter for body text
* Add favicon with white $ on midnight blue background
* Use stronger generated passwords for users
* Fix font not loading by setting Inter directly in theme
* Fix manifest.json syntax error by removing missing icon references
* Remove logo avatar and branding from login and sidebar
* Redesign login page to match copilot.money style
* Update default seed usernames
* Replace Supabase with local SQLite database and cookie-based auth
* Switch AI chat from Anthropic API to claude CLI for Claude Max usage
* Add seed script for creating users
* Initial release of Dough personal finance app
* Add dashboard with daily budget, spending chart, category breakdown, cash flow and recent transactions
* Add AI financial advisor chat
* Add transactions page with search and filters
* Add recurring bills management with due date tracking
* Add income sources tracking with expected dates
* Add debt tracker with snowball and avalanche payoff strategies
* Add settings page with profile, language and YNAB connection
* Add YNAB API client for budget, transactions and month data sync
* Add English and Finnish language support
* Add dark theme inspired by copilot.money design
* Add PWA manifest for home screen installation
