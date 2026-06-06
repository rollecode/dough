import { getHouseholdSetting } from "@/lib/household";

// Per-task AI model selection, configurable in settings and stored in household_settings.
// Defaults: fast Haiku for categorizing, Sonnet for Dougie chat, Opus (vision) for receipts.
// All are Claude CLI model aliases, so no API key is needed.
export type AiTask = "categorize" | "chat" | "vision";

export const AI_MODEL_DEFAULTS: Record<AiTask, string> = {
  categorize: "haiku",
  chat: "sonnet",
  vision: "opus",
};

export const AI_MODEL_CHOICES = ["haiku", "sonnet", "opus"] as const;

export function getAiModel(task: AiTask): string {
  try {
    const v = getHouseholdSetting(`ai_model_${task}`);
    if (v && (AI_MODEL_CHOICES as readonly string[]).includes(v)) return v;
  } catch {
    // settings unavailable; fall through to default
  }
  return AI_MODEL_DEFAULTS[task];
}
