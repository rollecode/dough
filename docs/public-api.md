## Public API (v1)

A versioned HTTP API for programmatic access: scripts, the Dough MCP server, the iOS app. Unlike
the internal `/api/*` routes, which use the browser `dough-session` cookie, the `/api/v1/*` routes
authenticate with an API key, so an external client reaches your finances without a login session.

A key carries `read`, or `read` and `write`. Read sees everything and changes nothing; write also
creates, edits and deletes. Some write endpoints are local mode only, and answer `400` in YNAB mode
where the data belongs to YNAB.

The full reference, every endpoint with its parameters, is served by the instance itself at
`/api-docs` and on the `api.` subdomain of the domain it runs on. This file covers how keys work;
the reference covers what you can call.

### Signing in instead of pasting a key

An app can send a person to their own instance to sign in, rather than asking for a key. Each
instance is its own OAuth 2.1 authorization server: a client reads
`/.well-known/oauth-authorization-server`, registers itself at `/api/oauth/register`, and opens
`/oauth/authorize`. Authorization code with PKCE (`S256`) is the only supported flow; there are no
client secrets. Codes are single use and expire in two minutes, access tokens last an hour, and
refresh tokens rotate on use. The resulting token authenticates `/api/v1` exactly as a key does.

The full sequence is on the instance's own reference at `/api-docs`.

### Authentication

Send the key, or an OAuth access token, as a bearer token:

```
Authorization: Bearer dough_xxxxxxxx...
```

`x-api-key: dough_xxxx...` is also accepted. A missing or invalid key returns `401`; a key without
the required scope returns `403`.

Only the SHA-256 hash of a key is stored, so the database never holds a usable secret and a key
cannot be shown again after creation. Keep keys in an environment variable, never in source (this is
a public repository).

### Creating a key

In the app, under Settings, then API keys. Name it, decide whether it may write, and copy it: the
plaintext is shown once and never again.

It can also be minted from the project root on the machine that owns the database, which is how it
worked before the settings page existed:

```
npx tsx scripts/create-api-key.ts --name "dough-mcp" --scopes read
```

Options:

- `--name` a label for the key (shown when listing keys)
- `--scopes` comma-separated, `read` (default) or `read,write`
- `--email` the owning user; defaults to the first user

The plaintext key is printed once. Store it immediately.

### Revoking a key

Revoke it in Settings, then API keys. It stops authenticating on the next request. The row is kept
rather than deleted, so it still explains what a key was when a client stops working.

By hand, set `revoked_at` on its row:

```
sqlite3 data/dough.db "UPDATE api_keys SET revoked_at = datetime('now') WHERE name = 'dough-mcp';"
```

### Endpoints

All responses are JSON. Amounts are in euros. A `month` parameter is `YYYY-MM` and defaults to the
current month in the server's timezone.

The endpoints, their parameters and their bodies are documented in the reference the instance
serves at `/api-docs`, built from `src/lib/api-docs.ts`. Adding a route means adding it there too,
so the reference cannot drift from the routes the way a hand-kept list in this file did.

Reads cover the summary, accounts, transactions, budget, categories, bills, subscriptions, income,
savings goals, debts, investments and net worth. Writes cover creating, editing and deleting each of
those, assigning and moving budget, and auto-assign. Transaction writes are local mode only.

### Example

```
curl -s https://your-domain.example.com/api/v1/summary \
  -H "Authorization: Bearer $DOUGH_API_KEY"
```

### MCP server

Every instance serves MCP at `/mcp` (Streamable HTTP, stateless, POST only). Each of its 43 tools maps one v1 endpoint and runs the route in the same process with the caller's own token, so a tool can never do more than that token can through the API: a read-only key reads, and a write tool answers with the 403.

A request without a token gets a 401 whose `WWW-Authenticate` header points at `/.well-known/oauth-protected-resource/mcp`. From there a client finds the instance's own OAuth server, registers itself, and sends the person to sign in and approve read or read and write. Web clients such as claude.ai return to an `https` address, native apps to their own scheme or loopback; the consent screen names where the code goes.

Ways to connect, all shown in Settings under AI assistants:

* claude.ai: the Install link opens Claude's add-connector dialog with the name and `https://your-domain.example.com/mcp` filled in
* Claude Code: `claude mcp add --transport http dough https://your-domain.example.com/mcp`, then `/mcp` to sign in
* any other client: an MCP configuration with `"type": "http"`, the `/mcp` address and an `Authorization: Bearer` header holding an API key made in Settings

The separate `dough-mcp` repo still works as a stdio server for clients that cannot speak HTTP.
