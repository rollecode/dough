import { getAiModel, isGeminiModel } from "./model";
import { gemini, geminiBilling } from "./gemini";
import { runClaude } from "./claude-cli";

// One short answer from the routine-work model: Gemini when the categorize model is a Gemini one
// and a key is there, otherwise the Claude CLI (Haiku when the setting names Gemini). `accept` turns
// the reply into a result or rejects it. Null when nothing was accepted.
export async function quickAnswer<T>(
  label: string,
  prompt: string,
  accept: (reply: string) => T | null,
  options: { maxOutputTokens?: number; timeoutMs?: number } = {}
): Promise<T | null> {
  const { timeoutMs = 30000 } = options;
  const model = getAiModel("categorize");
  const billing = geminiBilling();

  if (isGeminiModel(model) && billing) {
    try {
      // No output cap here: Gemini 3 counts its thinking against it and would cut the answer off.
      return accept(await gemini({ prompt, model, thinking: "minimal", timeoutMs }, billing));
    } catch (err) {
      console.warn(`[ai/${label}] Gemini failed:`, err);
      return null;
    }
  }

  const cliModel = isGeminiModel(model) ? "haiku" : model;
  try {
    const result = await runClaude(cliModel, prompt, timeoutMs);
    return accept(result);
  } catch (err) {
    console.warn(`[ai/${label}] failed:`, err);
    return null;
  }
}
