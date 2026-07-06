## Public API (v1)

A small, versioned, read-only HTTP API for programmatic access (scripts, the Dough MCP server).
Unlike the internal `/api/*` routes, which use the browser `dough-session` cookie, the `/api/v1/*`
routes authenticate with an API key. This lets external clients read your finances without a login
session.

The API key model stores a `scopes` field (`read`, or `read,write`) so write access can be added
later without changing how keys work. Today every v1 endpoint is `read`.

### Authentication

Send the key as a bearer token:

```
Authorization: Bearer dough_xxxxxxxx...
```

`x-api-key: dough_xxxx...` is also accepted. A missing or invalid key returns `401`; a key without
the required scope returns `403`.

Only the SHA-256 hash of a key is stored, so the database never holds a usable secret and a key
cannot be shown again after creation. Keep keys in an environment variable, never in source (this is
a public repository).

### Creating a key

From the project root on the server that owns the database:

```
npx tsx scripts/create-api-key.ts --name "dough-mcp" --scopes read
```

Options:

- `--name` a label for the key (shown when listing keys)
- `--scopes` comma-separated, `read` (default) or `read,write`
- `--email` the owning user; defaults to the first user

The plaintext key is printed once. Store it immediately.

### Revoking a key

Set `revoked_at` on its row; a revoked key stops authenticating on the next request.

```
sqlite3 data/dough.db "UPDATE api_keys SET revoked_at = datetime('now') WHERE name = 'dough-mcp';"
```

### Endpoints

All responses are JSON. Amounts are in euros. `month` params are `YYYY-MM` and default to the
current month in the server's Helsinki timezone.

- `GET /api/v1/summary` — total balance, and this month's income, budgeted, activity and Ready to
  Assign. Accepts `month`.
- `GET /api/v1/accounts` — every account with its balance. `include_closed=1` also returns closed
  accounts.
- `GET /api/v1/transactions` — transactions newest first. Optional `month`, `account_id`,
  `category`, `q` (search payee/memo), `limit` (1..500, default 50).
- `GET /api/v1/budget` — the month's income, total budgeted, Ready to Assign, age of money and every
  active category's budgeted / activity / available. Accepts `month`.
- `GET /api/v1/net-worth` — current net worth by kind (checking, savings, investments, debts) plus
  the saved snapshot history.
- `GET /api/v1/bills` — recurring bills with amount and due day.
- `GET /api/v1/subscriptions` — subscriptions with amount and due day.
- `GET /api/v1/savings-goals` — active goals with target and derived saved amount. Accepts `month`.

### Write endpoints (write scope)

These require a key minted with `--scopes read,write` and return `403` for a read-only key.

- `GET /api/v1/budget/auto-assign?month=YYYY-MM[&mode=...]` — preview target funding (no write). Without
  `mode`, the total each mode would assign; with `mode`, the full per-category plan.
- `POST /api/v1/budget/auto-assign` — apply a plan. Body: `{ "month": "YYYY-MM", "mode": "underfunded" | "last_assigned" | "last_spent" }`.
  Funds category targets from Ready to Assign, capped so it never overbudgets.
- `POST /api/v1/budget/assign` — set one category's amount. Body: `{ "month": "YYYY-MM", "category_id" | "category_name", "budgeted": number }`.
- `POST /api/v1/transactions/update` — patch one transaction by the id the read endpoints return;
  only provided fields change. Body: `{ "transaction_id", "amount"?, "inflow"?, "payee_name"?,
  "memo"?, "account_id"?, "date"?, "category"?, "transfer_account_id"? }`. `amount` is the absolute
  value (`inflow: true` stores it positive). Setting `category` to `Internal transfer` with a
  `transfer_account_id` fills the counterpart account and maintains the opposite leg. Local mode
  only.
- `POST /api/v1/transactions/delete` — remove one transaction (split siblings included) and reverse
  its balance effect. Body: `{ "transaction_id" }`. Local mode only.

### Example

```
curl -s https://your-dough-host/api/v1/summary \
  -H "Authorization: Bearer $DOUGH_API_KEY"
```

### MCP server

The Dough MCP server (separate repo) is a thin client of this API: it reads `DOUGH_API_URL` and
`DOUGH_API_KEY` from its environment and exposes each endpoint as an MCP tool, so an assistant can
query your finances. See that repo's README for install and client configuration.
