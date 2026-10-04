import { aiBilling, aiSpendThisMonth, lastAiResult, type AiProvider } from "./claude-cli";
import { geminiBilling } from "./gemini";
import { getAiModel, isGeminiModel, type AiTask } from "./model";

export type AiState = "ok" | "failing" | "off";

export interface AiServiceStatus {
  task: AiTask;
  provider: AiProvider;
  model: string;
  state: AiState;
  error?: string;
  lastAt?: string;
}

export interface AiStatus {
  services: AiServiceStatus[];
  // Null when unlimited; otherwise how much of this month's allowance is used, 0-100.
  limitUsedPercent: number | null;
  limitResets: string;
}

const TASKS: AiTask[] = ["chat", "vision", "categorize", "insight"];

// Which provider each AI service runs on right now and whether it works, from the settings and the
// last call each provider answered.
export function aiStatus(): AiStatus {
  const gemini = geminiBilling();
  let claudeCap: number | null = null;
  let claudeOff: string | undefined;
  try {
    claudeCap = aiBilling().capUsd;
  } catch (err) {
    claudeOff = (err as Error).message;
  }

  const services = TASKS.map((task): AiServiceStatus => {
    const configured = getAiModel(task);
    const onGemini = task !== "chat" && isGeminiModel(configured) && !!gemini;
    const provider: AiProvider = onGemini ? "gemini" : "claude";
    const model = onGemini || !isGeminiModel(configured) ? configured : "claude";
    if (provider === "claude" && claudeOff) {
      return { task, provider, model, state: "off", error: claudeOff };
    }
    const last = lastAiResult(provider);
    if (last && !last.ok) {
      return { task, provider, model, state: "failing", error: last.error, lastAt: last.at };
    }
    return { task, provider, model, state: "ok", lastAt: last?.at };
  });

  const used = new Set(services.filter((s) => s.state !== "off").map((s) => s.provider));
  const caps = [used.has("claude") ? claudeCap : null, used.has("gemini") ? gemini?.capUsd ?? null : null].filter((c): c is number => c !== null);
  const cap = caps.length ? Math.min(...caps) : null;
  const now = new Date();
  const resets = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  console.debug("[ai/status]", services.map((s) => `${s.task}:${s.provider}:${s.state}`).join(" "), "cap:", cap);
  return {
    services,
    limitUsedPercent: cap === null ? null : Math.min(100, Math.round((aiSpendThisMonth() / cap) * 100)),
    limitResets: `${resets.getFullYear()}-${String(resets.getMonth() + 1).padStart(2, "0")}-01`,
  };
}
