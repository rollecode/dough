import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeArgs, claudeEnv } from "@/lib/ai/claude-cli";

test("the CLI runs with every tool and MCP server switched off", () => {
  const args = claudeArgs(["-p", "-"]);
  assert.deepEqual(args.slice(0, 2), ["--tools", ""]);
  assert.ok(args.includes("--strict-mcp-config"));
  assert.deepEqual(args.slice(-2), ["-p", "-"]);
});

test("the CLI gets only the environment it needs", () => {
  process.env.YNAB_TOKEN = "secret";
  process.env.CLAUDE_CONFIG_DIR = "/tmp/claude";
  const env = claudeEnv();
  assert.equal(env.SESSION_SECRET, undefined);
  assert.equal(env.YNAB_TOKEN, undefined);
  assert.equal(env.HOME, process.env.HOME);
  assert.equal(env.CLAUDE_CONFIG_DIR, "/tmp/claude");
  assert.equal(env.CLAUDE_CODE_ENTRYPOINT, "cli");
});

// A stand-in for the CLI: answers in JSON when asked to, and says which key it was given.
async function fakeCli(): Promise<string> {
  const { mkdtempSync, writeFileSync, chmodSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const file = join(mkdtempSync(join(tmpdir(), "fake-claude-")), "claude");
  writeFileSync(file, `#!/bin/sh
cat > /dev/null
answer="key=\${ANTHROPIC_API_KEY:-none}"
case "$*" in
  *"--output-format json"*) printf '{"result":"%s","total_cost_usd":0.4}' "$answer" ;;
  *) printf '%s' "$answer" ;;
esac
`);
  chmodSync(file, 0o755);
  return file;
}

test("a household's own key is used and never metered", async () => {
  const { runClaude, aiSpendThisMonth } = await import("@/lib/ai/claude-cli");
  const { setHouseholdSetting } = await import("@/lib/household");
  const { getDb } = await import("@/lib/db");
  process.env.CLAUDE_PATH = await fakeCli();
  process.env.DOUGH_AI_MONTHLY_CAP_USD = "1";
  setHouseholdSetting("anthropic_api_key", "sk-own");
  assert.equal(await runClaude("haiku", "hi", 5000), "key=sk-own");
  assert.equal(aiSpendThisMonth(), 0);
  getDb().prepare("DELETE FROM household_settings WHERE key = 'anthropic_api_key'").run();
});

test("a hosted household without a key spends the allowance until it is gone", async () => {
  const { runClaude, aiSpendThisMonth } = await import("@/lib/ai/claude-cli");
  process.env.CLAUDE_PATH = await fakeCli();
  process.env.DOUGH_AI_MONTHLY_CAP_USD = "1";
  assert.equal(await runClaude("haiku", "hi", 5000), "key=none");
  assert.equal(await runClaude("haiku", "hi", 5000), "key=none");
  assert.equal(Math.round(aiSpendThisMonth() * 10) / 10, 0.8);
  await runClaude("haiku", "hi", 5000);
  await assert.rejects(runClaude("haiku", "hi", 5000), /allowance is used up/);
  delete process.env.DOUGH_AI_MONTHLY_CAP_USD;
  delete process.env.CLAUDE_PATH;
});
