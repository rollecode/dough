import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { gemini, geminiBilling, geminiCostUsd } from "@/lib/ai/gemini";
import { aiSpendThisMonth } from "@/lib/ai/claude-cli";
import { runWithHousehold } from "@/lib/db";
import { setHouseholdSetting } from "@/lib/household";

const realFetch = globalThis.fetch;
let sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;

function fakeGemini(reply: unknown, status = 200) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify(reply), { status });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.DOUGH_AI_MONTHLY_CAP_USD;
});

const answer = (text: string, usage = { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 100 }) => ({
  candidates: [{ content: { parts: [{ text: "thinking...", thought: true }, { text }] } }],
  usageMetadata: usage,
});

test("the key travels in a header, never the address, and thinking text is left out", async () => {
  fakeGemini(answer("Groceries"));
  const out = await gemini({ prompt: "p", image: { data: "aGk=", mediaType: "image/png" }, thinking: "minimal" }, { apiKey: "gk-secret", capUsd: null });
  assert.equal(out, "Groceries");
  assert.ok(!sent!.url.includes("gk-secret"));
  assert.equal(sent!.headers["x-goog-api-key"], "gk-secret");
  assert.match(sent!.url, /gemini-3-flash-preview:generateContent$/);
  const parts = (sent!.body.contents as { parts: Record<string, unknown>[] }[])[0].parts;
  assert.ok("inlineData" in parts[0]);
  assert.deepEqual(sent!.body.generationConfig, { thinkingConfig: { thinkingLevel: "minimal" } });
});

test("an error from Google is passed on with its status", async () => {
  fakeGemini({ error: { message: "API key not valid" } }, 400);
  await assert.rejects(gemini({ prompt: "p" }, { apiKey: "bad", capUsd: null }), /Gemini answered 400/);
});

test("a household's own key is used first and never metered", () => {
  const dir = mkdtempSync(join(tmpdir(), "dough-gemini-"));
  process.env.GEMINI_API_KEY = "server-key";
  const billing = runWithHousehold({ id: "own", dbPath: join(dir, "own.db") }, () => {
    setHouseholdSetting("gemini_api_key", "own-key");
    return geminiBilling();
  });
  assert.deepEqual(billing, { apiKey: "own-key", capUsd: null });
});

test("in the cloud a household without a key spends the server key's allowance", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dough-gemini-"));
  const household = { id: "guest", dbPath: join(dir, "guest.db") };
  process.env.GEMINI_API_KEY = "server-key";
  process.env.DOUGH_AI_MONTHLY_CAP_USD = "1";
  fakeGemini(answer("ok"));
  await runWithHousehold(household, async () => {
    assert.equal((await gemini({ prompt: "p" })), "ok");
    assert.equal(sent!.headers["x-goog-api-key"], "server-key");
    assert.equal(aiSpendThisMonth(), geminiCostUsd({ promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 100 }));
  });
});

test("self-hosted without a key there is no Gemini to use", () => {
  process.env.GEMINI_API_KEY = "server-key";
  assert.equal(geminiBilling(), null);
});
