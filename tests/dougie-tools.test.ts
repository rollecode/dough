import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb } from "@/lib/db";
import { runClaude } from "@/lib/ai/claude-cli";
import { withDougieTools } from "@/lib/ai/dougie-tools";

test("Dougie acts through the household's MCP with a key that lives for one answer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const argsFile = join(dir, "args");
  const cli = join(dir, "claude");
  writeFileSync(cli, `#!/bin/sh\ncat > /dev/null\nprintf '%s\\n' "$@" > "${argsFile}"\nprintf 'done'\n`);
  chmodSync(cli, 0o755);
  process.env.CLAUDE_PATH = cli;
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (7, 'd@example.com', 'x')").run();

  const answer = await withDougieTools(7, "https://home.example", (args) => runClaude("sonnet", "hi", 5000, args));
  assert.equal(answer, "done");

  const args = readFileSync(argsFile, "utf8").split("\n");
  const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
  assert.equal(config.mcpServers.dough.url, "https://home.example/mcp");
  assert.match(config.mcpServers.dough.headers.Authorization, /^Bearer dough_/);
  assert.ok(args.includes("mcp__dough"), "the household's tools are allowed");
  assert.ok(args.includes("mcp__dough__dough_delete_my_account"), "deleting is withheld");
  assert.ok(args.includes("--strict-mcp-config"), "no other MCP servers");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = 7").get() as { n: number }).n, 0, "the key is gone afterwards");
  delete process.env.CLAUDE_PATH;
});

test("every tool Dougie is denied exists, so a renamed tool cannot slip through", async () => {
  const { DOUGIE_DENIED } = await import("@/lib/ai/dougie-tools");
  const tools = readFileSync("src/lib/mcp/tools.ts", "utf8");
  for (const name of DOUGIE_DENIED) assert.ok(tools.includes(`"${name}"`), name);
  for (const name of ["dough_update_account", "dough_update_settings", "dough_add_payee_match", "dough_auto_assign_apply"]) {
    assert.ok(DOUGIE_DENIED.includes(name), name);
  }
});
