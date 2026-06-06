import { getHouseholdSetting } from "@/lib/household";

// Per-task AI model selection, configurable in settings (stored in household_settings).
// Tiering: routine/daily work (categorizing) defaults to fast, near-free Gemini 2.5 Flash over
// HTTP; demanding work (Dougie chat, receipt vision) defaults to Claude Opus 4.8 over the CLI,
// which is covered by the Claude Code subscription (no per-token cost).
export type AiTask = "categorize" | "chat" | "vision";

export const AI_MODEL_DEFAULTS: Record<AiTask, string> = {
  categorize: "gemini-2.5-flash",
  chat: "opus",
  vision: "opus",
};

// Claude CLI model aliases (covered by the subscription)
export const CLI_MODEL_CHOICES = ["haiku", "sonnet", "opus"] as const;
// Models that can be selected for categorizing (adds the HTTP Gemini option)
export const CATEGORIZE_MODEL_CHOICES = ["gemini-2.5-flash", ...CLI_MODEL_CHOICES] as const;

const ALLOWED = new Set<string>([...CATEGORIZE_MODEL_CHOICES]);

export function getAiModel(task: AiTask): string {
  try {
    const v = getHouseholdSetting(`ai_model_${task}`);
    if (v && ALLOWED.has(v)) return v;
  } catch {
    // settings unavailable; fall through to default
  }
  return AI_MODEL_DEFAULTS[task];
}

export function isGeminiModel(model: string): boolean {
  return model.startsWith("gemini");
}

export function getGeminiKey(): string {
  try {
    return getHouseholdSetting("gemini_api_key") || "";
  } catch {
    return "";
  }
}
