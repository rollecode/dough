# Dough

![Next.js](https://img.shields.io/badge/Next.js_16-000000?style=for-the-badge&logo=next.js&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Claude](https://img.shields.io/badge/Claude_AI-cc785c?style=for-the-badge&logo=anthropic&logoColor=white)
<img width="80" height="28" alt="YNAB" src="https://github.com/user-attachments/assets/c7300ced-3496-4604-ad5d-22cd60f73276" /> 

A self-hosted personal finance dashboard that connects to [YNAB](https://www.ynab.com/) and uses [Claude](https://code.claude.com/docs/en/cli-reference) for financial advice, spending summaries, and debt strategies.

<img width="1666" height="1102" alt="image" src="https://github.com/user-attachments/assets/451f341a-9ba4-4658-be3a-361dc3ba06d4" />

## Why Dough

YNAB is great for detailed per-account envelope budgeting, but it's an individual tool. When you share finances with a partner, you need a shared view that answers simple questions: "how much can we spend today?", "are we on track this month?", "can we afford eating out tonight?"

Dough was built to solve this:

- **Accountless by design** - no separate checking, savings, or credit card views. One household, one balance, one daily budget. Your partner doesn't need to understand account structures or envelope budgeting.
- **Household-first** - all data is shared. Both users see the same dashboard, same AI advisor, same bills and income. No "my budget" vs "your budget."
- **AI that knows your situation** - Claude has full context of your balance, bills, debts, income dates, and spending patterns. Ask "can I buy lunch today?" and get a real answer based on cash flow simulation, not a generic rule.
- **Cash flow simulation** - the daily budget accounts for when income arrives and when bills are due. It knows your tax payment is due the day before salary and doesn't panic about it.
- **Receipt scanning** - snap a photo of a receipt in the chat, the AI reads it and adds the expense to YNAB automatically.
- **Works alongside YNAB** - Dough doesn't replace YNAB's envelope budgeting or bank connections. It's an intelligence layer on top. YNAB handles the accounting, Dough handles the "how are we doing?" question.
- **Self-hosted, private** - your financial data stays on your machine. No cloud services, no third-party access. SQLite database you can back up with a single file copy.

## Features

- **Dashboard** with daily budget, burn rate, month status, spending chart, category breakdown, cash flow, and net worth
- **AI advisor** chat with full financial context, shared across household members
- **AI summary** generated daily with spending analysis and projections
- **Bills** tracking with YNAB payee matching, overdue detection, and manual paid toggles
- **Income** sources with expected dates and auto-matching to YNAB transactions
- **Debts** pulled from YNAB with editable interest rates, snowball/avalanche strategies
- **Investments** pulled from YNAB with monthly contributions and compound growth projections
- **Net worth** history with daily snapshots and area chart
- **Transactions** synced from YNAB with search, filtering, and manual expense entry
- **Real-time** updates via Server-Sent Events across all connected clients
- **Multi-user** household support with shared data and per-user settings
- **Bilingual** English and Finnish with per-user language preference

## Requirements

- Node.js 22+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with an active Claude subscription (`claude` command in PATH) for AI features
- YNAB account with [personal access token](https://app.ynab.com/settings/developer)
- Linux or macOS (tested on Arch Linux)

## Installation

```bash
git clone https://github.com/rollecode/dough.git
cd dough
npm install
```

### Configuration

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```bash
# Required: random string for JWT signing
SESSION_SECRET=change-me-to-something-random

# Optional: can be set via settings UI instead
YNAB_ACCESS_TOKEN=your-ynab-personal-access-token
YNAB_BUDGET_ID=your-budget-id

# Optional: path to claude CLI binary, defaults to "claude" in PATH
# CLAUDE_PATH=/path/to/claude
```

### Create users

```bash
USER1_EMAIL=yourname USER1_PASSWORD=yourpassword USER1_NAME="Your Name" \
USER2_EMAIL=partner USER2_PASSWORD=partnerpassword USER2_NAME="Partner" \
npx tsx scripts/seed.ts
```

You can create 1 or 2 users. Set only `USER1_*` vars for a single user.

### Build and run

```bash
npm run build
npm start -- -p 3001
```

The app runs at `http://localhost:3001`.

### First login

1. Log in with the credentials from the seed script
2. Go to Settings and paste your YNAB personal access token
3. Select your budget and sync
4. Set your display name, household details, and link your spending account
5. Add income sources and recurring bills with YNAB payee patterns

## YNAB setup

1. Go to [YNAB Developer Settings](https://app.ynab.com/settings/developer)
2. Create a personal access token
3. Paste it in Dough settings or `.env.local`
4. Select your budget and sync

Dough caches YNAB data locally in SQLite. Syncing is manual (button press) to avoid rate limits. The app works fully offline with cached data.

## AI setup

Dough uses the [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) for AI features. Install it and make sure `claude` is available in your PATH.

AI features:
- **Chat advisor** with full financial context (balance, transactions, bills, debts, investments, income)
- **Daily summary** with spending analysis and month-end projections
- **Debt payoff suggestions** with strategy recommendations

All AI prompts are editable in Settings. The household profile is injected into every prompt for personalized advice.

## Running as a service

### systemd (Linux)

```bash
mkdir -p ~/.config/systemd/user
```

Create `~/.config/systemd/user/dough.service`:

```ini
[Unit]
Description=Dough personal finance app
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/path/to/dough
ExecStart=/path/to/node node_modules/.bin/next start -p 3001
Restart=on-failure
RestartSec=2
TimeoutStopSec=5
KillMode=mixed
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now dough
```

### Cloudflare tunnel (optional)

To expose the app over the internet:

```bash
cloudflared tunnel create dough
cloudflared tunnel route dns dough your-domain.example.com
```

Create `~/.cloudflared/config-dough.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: ~/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: your-domain.example.com
    service: http://localhost:3001
  - service: http_status:404
```

## Backups

The SQLite database is at `data/dough.db`. Back it up regularly:

```bash
sqlite3 data/dough.db ".backup /path/to/backup/dough-$(date +%Y%m%d).db"
```

## Development

```bash
npm run dev
```

Runs with Turbopack at `http://localhost:3000`.

### Code style

- Custom CSS framework (no Tailwind), classes over inline styles
- Sentence case for headings and commits
- Verbose logging at every step (debug, info, warning, error)
- DRY code, shared utilities extracted
- No emojis in code or commits

### Adding a new page

1. Create the page at `src/app/(app)/your-page/page.tsx`
2. Add the API route at `src/app/api/your-feature/route.ts`
3. Add translations to `src/lib/i18n/en.ts` and `fi.ts`
4. Add sidebar nav item in `src/components/layout/sidebar.tsx`
5. Use existing CSS classes from `src/styles/modules/pages.css`

### Adding translations

All UI text lives in `src/lib/i18n/en.ts` (English) and `fi.ts` (Finnish). Add keys to both files with matching structure.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Keep commits concise and in present tense
5. Update `CHANGELOG.md` and relevant docs
6. Submit a pull request

## Documentation

Detailed docs live in the `docs/` directory:

- [Setup guide](docs/setup.md) - installation, configuration, deployment
- [Features](docs/features.md) - complete feature list
- [Architecture](docs/architecture.md) - tech stack, database schema, data flow
- [API reference](docs/api.md) - all endpoints
- [CSS framework](docs/css-framework.md) - styling conventions
- [Real-time](docs/real-time.md) - SSE implementation

## License

Dough is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, modify, and share it for any noncommercial purpose - personal use, hobby projects, study, and use by nonprofit, educational, research, and government organizations. Commercial use is not permitted.
