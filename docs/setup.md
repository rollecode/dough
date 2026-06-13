## Setup guide

### Requirements

- Node.js 22+ (tested with v22.20.0)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with an active Claude subscription (`claude` command in PATH) for AI features
- Optional: a YNAB account with a personal access token, only if you want to connect YNAB
- SQLite (bundled via better-sqlite3, no separate install)

### Installation

```bash
git clone git@github.com:rollecode/dough.git
cd dough
npm install
```

### Configuration

Copy the example env file:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

- `SESSION_SECRET` — random string for JWT signing
- `YNAB_ACCESS_TOKEN` — optional, can be set via settings UI instead
- `YNAB_BUDGET_ID` — optional, can be set via settings UI instead
- `CLAUDE_PATH` — path to claude CLI binary, defaults to `claude` in PATH

### Create users

Set env vars and run the seed script:

```bash
USER1_EMAIL=yourname USER1_PASSWORD=yourpassword USER1_NAME="Your Name" \
USER2_EMAIL=partner USER2_PASSWORD=partnerpassword USER2_NAME="Partner" \
npx tsx scripts/seed.ts
```

### Build and run

```bash
npm run build
npm start -- -p 3001
```

The app runs at `http://localhost:3001`.

### First login

1. Log in with the credentials you set in the seed script
2. Set your name, household size, and add your accounts (or connect YNAB - see below)
3. Link your spending account so the daily budget knows what you pay from
4. Add income sources and recurring bills, and set up budget categories and targets
5. Optionally connect Synci to import bank transactions automatically (see the timer section below)

Dough chooses its mode automatically: without a YNAB token and budget it runs standalone (its own
accounts, transactions, and envelope budgeting); with them it mirrors YNAB. To connect YNAB, paste a
personal access token in settings (or `.env.local`) and select your budget.

### Cloudflare tunnel (optional)

To expose the app publicly:

```bash
cloudflared tunnel create dough
cloudflared tunnel route dns dough your-domain.example.com
```

Create a config file at `~/.cloudflared/config-dough.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: ~/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: your-domain.example.com
    service: http://localhost:3001
  - service: http_status:404
```

### Systemd services (optional)

Create user services for auto-start:

```bash
# ~/.config/systemd/user/dough.service
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
systemctl --user enable dough
systemctl --user start dough
```

### Periodic Synci sync (systemd timer)

Synci sync is idempotent (it skips anything already imported or added manually), so it is safe to
run on a timer. Set a `cron_secret` household setting, then install a service + timer that polls it:

```bash
# ~/.config/systemd/user/dough-synci.service
[Unit]
Description=Dough Synci sync

[Service]
Type=oneshot
ExecStart=/usr/bin/curl -fsS -X POST http://127.0.0.1:3001/api/synci/sync -H "X-Cron-Secret: YOUR_CRON_SECRET"
```

```bash
# ~/.config/systemd/user/dough-synci.timer
[Unit]
Description=Run Dough Synci sync every 30 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl --user enable --now dough-synci.timer
systemctl --user list-timers dough-synci.timer   # verify it is scheduled
```

### Backups

The SQLite database lives at `data/dough.db`. Back it up regularly:

```bash
sqlite3 data/dough.db ".backup /path/to/backup/dough-$(date +%Y%m%d).db"
```
