## Setup guide

### Requirements

- Node.js 22+ (tested with v22.20.0)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with an active Claude subscription (`claude` command in PATH) for AI features
- YNAB account with personal access token
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
2. Go to settings and connect YNAB (paste your personal access token)
3. Select your budget
4. Set your name, household size, and link your spending account
5. Add income sources and recurring bills

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

### Backups

The SQLite database lives at `data/dough.db`. Back it up regularly:

```bash
sqlite3 data/dough.db ".backup /path/to/backup/dough-$(date +%Y%m%d).db"
```
