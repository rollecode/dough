import { getAiModel, isGeminiModel, getGeminiKey } from "./model";
import { geminiText } from "./gemini";
import { spawn } from "child_process";

// Pick the best-fitting category for a payee from the given list, using the configured
// per-task model: fast Gemini when a key is set, otherwise the Claude CLI (Haiku fallback).
// Returns an exact match from `categories` or null. Shared by manual add and Synci import.
export async function categorizePayee(payee: string, categories: string[]): Promise<string | null> {
  if (!payee || categories.length === 0) return null;
  const model = getAiModel("categorize");
  const prompt = `Given the payee "${payee}", which category fits best from this list? Reply with ONLY the exact category name, nothing else.\n\nCategories:\n${categories.join("\n")}`;

  if (isGeminiModel(model)) {
    const key = getGeminiKey();
    if (key) {
      const out = await geminiText(prompt, key, model);
      const match = out && categories.find((c) => c.toLowerCase() === out.toLowerCase());
      if (match) return match;
    }
  }

  const cliModel = isGeminiModel(model) ? "haiku" : model;
  const claudePath = process.env.CLAUDE_PATH || "claude";
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn(claudePath, ["-p", "--model", cliModel, "-"], { timeout: 30000 });
      let stdout = "";
      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.on("close", (code: number) => { if (code === 0 && stdout.trim()) resolve(stdout.trim()); else reject(new Error("categorize failed")); });
      proc.on("error", reject);
      proc.stdin.write(prompt);
      proc.stdin.end();
    });
    return categories.find((c) => c.toLowerCase() === result.toLowerCase()) || null;
  } catch (err) {
    console.warn("[ai/categorize] failed:", err);
    return null;
  }
}
