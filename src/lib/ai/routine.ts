import { gemini, geminiBilling, type ThinkingLevel } from "./gemini";
import { runClaude } from "./claude-cli";
import { queryClaudeWithImage } from "./claude-image";
import { getAiModel, isGeminiModel, type AiTask } from "./model";
import { attachmentProblem } from "./attachment";

export interface RoutineOptions {
  image?: { data: string; mediaType: string };
  maxOutputTokens?: number;
  thinking?: ThinkingLevel;
  timeoutMs?: number;
  // The Claude model to use when this task falls back to the CLI.
  claudeModel?: string;
}

// Every AI task except Dougie. Gemini answers when the task's model is a Gemini one and a key is
// there; otherwise the Claude CLI does, as a self-hosted instance without a Gemini key always has.
export async function routineAnswer(task: AiTask, prompt: string, options: RoutineOptions = {}): Promise<string> {
  const problem = options.image && attachmentProblem(options.image.data, options.image.mediaType);
  if (problem) {
    throw new Error(problem);
  }
  const model = getAiModel(task);
  const timeoutMs = options.timeoutMs ?? 60000;
  const billing = geminiBilling();

  if (isGeminiModel(model) && billing) {
    console.debug("[ai/routine]", task, "on", model);
    return gemini({ prompt, image: options.image, model, maxOutputTokens: options.maxOutputTokens, thinking: options.thinking, timeoutMs }, billing);
  }

  const claudeModel = isGeminiModel(model) ? options.claudeModel ?? "sonnet" : model;
  console.debug("[ai/routine]", task, "on the Claude CLI,", claudeModel);
  if (options.image) {
    const result = await queryClaudeWithImage(prompt, options.image.data, options.image.mediaType, timeoutMs, claudeModel);
    if (result.error) {
      throw new Error(result.error);
    }
    return result.text;
  }
  return runClaude(claudeModel, prompt, timeoutMs);
}
