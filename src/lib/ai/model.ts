import { getHouseholdSetting } from "@/lib/household";

// Per-task AI model, configurable in settings (stored in household_settings). Dougie (chat) runs on
// the Claude CLI; everything else defaults to Gemini over its API: categorizing and quick answers,
// receipt images (vision) and the written insights (summary, debt advice, balance reconcile).
export type AiTask = "categorize" | "chat" | "vision" | "insight";

export const GEMINI_DEFAULT = "gemini-3-flash-preview";

export const AI_MODEL_DEFAULTS: Record<AiTask, string> = {
  categorize: GEMINI_DEFAULT,
  chat: "opus",
  vision: GEMINI_DEFAULT,
  insight: GEMINI_DEFAULT,
};

// Claude CLI model aliases
export const CLI_MODEL_CHOICES = ["haiku", "sonnet", "opus"] as const;
export const GEMINI_MODEL_CHOICES = [GEMINI_DEFAULT, "gemini-2.5-flash"] as const;
export const CATEGORIZE_MODEL_CHOICES = [...GEMINI_MODEL_CHOICES, ...CLI_MODEL_CHOICES] as const;

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
