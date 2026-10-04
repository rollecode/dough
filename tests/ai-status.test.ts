import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function failingCli(): string {
  const file = join(mkdtempSync(join(tmpdir(), "fake-claude-")), "claude");
  writeFileSync(file, "#!/bin/sh\ncat > /dev/null\necho 'Not logged in' >&2\nexit 1\n");
  chmodSync(file, 0o755);
  return file;
}

test("self-hosted without a Gemini key runs everything on Claude, unlimited", async () => {
  const { aiStatus } = await import("@/lib/ai/status");
  const status = aiStatus();
  assert.deepEqual(status.services.map((s) => s.provider), ["claude", "claude", "claude", "claude"]);
  assert.ok(status.services.every((s) => s.state === "ok"));
  assert.equal(status.limitUsedPercent, null);
});

test("a failed call turns its provider's services to failing with the reason", async () => {
  const { aiStatus } = await import("@/lib/ai/status");
  const { runClaude } = await import("@/lib/ai/claude-cli");
  process.env.CLAUDE_PATH = failingCli();
  await assert.rejects(runClaude("haiku", "hi", 5000));
  const dougie = aiStatus().services.find((s) => s.task === "chat")!;
  assert.equal(dougie.state, "failing");
  assert.match(dougie.error ?? "", /Not logged in/);
  delete process.env.CLAUDE_PATH;
});

test("in the cloud, others are metered on Gemini and Dougie is off; the owner is unlimited", async () => {
  const { aiStatus } = await import("@/lib/ai/status");
  const { recordAiSpend } = await import("@/lib/ai/claude-cli");
  const { runWithHousehold } = await import("@/lib/db");
  const dir = mkdtempSync(join(tmpdir(), "dough-status-"));
  const owner = { id: "owner", dbPath: join(dir, "owner.db") };
  const other = { id: "other", dbPath: join(dir, "other.db") };
  process.env.DOUGH_OWNER_HOUSEHOLDS = "owner";
  process.env.DOUGH_AI_MONTHLY_CAP_USD = "2";
  process.env.GEMINI_API_KEY = "server-key";

  const theirs = runWithHousehold(other, () => {
    recordAiSpend(0.5);
    return aiStatus();
  });
  assert.equal(theirs.services.find((s) => s.task === "chat")!.state, "off");
  assert.equal(theirs.services.find((s) => s.task === "vision")!.provider, "gemini");
  assert.equal(theirs.limitUsedPercent, 25);

  const mine = runWithHousehold(owner, () => aiStatus());
  assert.ok(mine.services.every((s) => s.state === "ok"));
  assert.equal(mine.limitUsedPercent, null);

  delete process.env.DOUGH_OWNER_HOUSEHOLDS;
  delete process.env.DOUGH_AI_MONTHLY_CAP_USD;
  delete process.env.GEMINI_API_KEY;
});
