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
