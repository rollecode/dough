import { getAiModel, isGeminiModel, getGeminiKey } from "./model";
import { geminiText } from "./gemini";
import { runClaude } from "./claude-cli";

// One short answer from the routine-work model: fast Gemini when a key is set, otherwise the
// Claude CLI (Haiku fallback). `accept` turns the reply into a result or rejects it; a Gemini
// reply that is rejected still gets a second try from the CLI. Null when nothing was accepted.
export async function quickAnswer<T>(
  label: string,
  prompt: string,
  accept: (reply: string) => T | null,
  options: { maxOutputTokens?: number; timeoutMs?: number } = {}
): Promise<T | null> {
  const { maxOutputTokens = 40, timeoutMs = 30000 } = options;
  const model = getAiModel("categorize");

  if (isGeminiModel(model)) {
    const key = getGeminiKey();
    if (key) {
      const out = await geminiText(prompt, key, model, maxOutputTokens);
      const accepted = out ? accept(out) : null;
      if (accepted !== null) return accepted;
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
