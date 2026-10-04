import { getHouseholdSetting } from "@/lib/household";
import { currentHousehold } from "@/lib/db";
import { aiAllowanceLeft, isOwnerHousehold, recordAiResult, recordAiSpend } from "./claude-cli";

export const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
// Paid tier, dollars per million tokens; thinking is billed as output.
const PRICE_IN_USD = 0.5;
const PRICE_OUT_USD = 3.0;
const MILLION = 1_000_000;

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface GeminiRequest {
  prompt: string;
  image?: { data: string; mediaType: string };
  model?: string;
  maxOutputTokens?: number;
  thinking?: ThinkingLevel;
  timeoutMs?: number;
}

interface GeminiBilling {
  apiKey: string;
  capUsd: number | null;
}

// Whose Gemini key a call uses: the household's own, unmetered. In the cloud, a household without
// one spends the service's key up to the monthly cap. Null when there is no key at all.
export function geminiBilling(): GeminiBilling | null {
  const own = getHouseholdSetting("gemini_api_key");
  if (own) {
    return { apiKey: own, capUsd: null };
  }
  const server = process.env.GEMINI_API_KEY;
  const household = currentHousehold();
  if (!household || !server) {
    return null;
  }
  if (isOwnerHousehold(household.id)) {
    return { apiKey: server, capUsd: null };
  }
  const cap = parseFloat(process.env.DOUGH_AI_MONTHLY_CAP_USD || "");
  return { apiKey: server, capUsd: Number.isFinite(cap) ? cap : null };
}

export function geminiCostUsd(usage: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }): number {
  const input = usage.promptTokenCount ?? 0;
  const output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return (input * PRICE_IN_USD + output * PRICE_OUT_USD) / MILLION;
}

// One prompt, optionally with an image or PDF, in; the answer's text out. Throws with the reason on
// any failure. The key goes in a header, never the address, so it cannot end up in a log.
export async function gemini(req: GeminiRequest, billing: GeminiBilling | null = geminiBilling()): Promise<string> {
  if (!billing) {
    throw new Error("Add a Gemini API key in Settings to use AI");
  }
  aiAllowanceLeft(billing.capUsd);
  try {
    const answer = await callGemini(req, billing);
    recordAiResult("gemini");
    return answer;
  } catch (err) {
    recordAiResult("gemini", err);
    throw err;
  }
}

async function callGemini(req: GeminiRequest, billing: GeminiBilling): Promise<string> {
  const model = req.model || GEMINI_MODEL;
  const parts: unknown[] = [];
  if (req.image) {
    parts.push({ inlineData: { mimeType: req.image.mediaType, data: req.image.data } });
  }
  parts.push({ text: req.prompt });
  const generationConfig: Record<string, unknown> = { thinkingConfig: { thinkingLevel: req.thinking ?? "low" } };
  if (req.maxOutputTokens) {
    generationConfig.maxOutputTokens = req.maxOutputTokens;
  }

  console.debug("[gemini] Request to", model, "image:", !!req.image, "thinking:", req.thinking ?? "low");
  const res = await fetch(`${GEMINI_API}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": billing.apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 60000),
  });
  const body = await res.text();
  if (!res.ok) {
    console.warn("[gemini] HTTP", res.status, body.slice(0, 300));
    throw new Error(`Gemini answered ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = JSON.parse(body);
  if (billing.capUsd !== null && data.usageMetadata) {
    recordAiSpend(geminiCostUsd(data.usageMetadata));
  }
  const out = ((data?.candidates?.[0]?.content?.parts ?? []) as { text?: string; thought?: boolean }[])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!out) {
    throw new Error(`Gemini returned no answer (${data?.candidates?.[0]?.finishReason ?? "no candidate"})`);
  }
  console.info("[gemini] Got answer, length:", out.length);
  return out;
}

// The old one-line helper, kept for callers that treat a failure as no answer.
export async function geminiText(prompt: string, apiKey: string, model = GEMINI_MODEL, maxOutputTokens = 40): Promise<string | null> {
  try {
    return await gemini({ prompt, model, maxOutputTokens, thinking: "minimal" }, { apiKey, capUsd: null });
  } catch (err) {
    console.warn("[gemini] request failed:", err);
    return null;
  }
}
