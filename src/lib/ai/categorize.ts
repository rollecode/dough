import { quickAnswer } from "./quick-answer";

// Pick the best-fitting category for a payee from the given list, using the configured
// per-task model: fast Gemini when a key is set, otherwise the Claude CLI (Haiku fallback).
// Returns an exact match from `categories` or null. Shared by manual add and Synci import.
export async function categorizePayee(payee: string, categories: string[]): Promise<string | null> {
  if (!payee || categories.length === 0) return null;
  const prompt = `Given the payee "${payee}", which category fits best from this list? Reply with ONLY the exact category name, nothing else.\n\nCategories:\n${categories.join("\n")}`;
  return quickAnswer("categorize", prompt, (out) => categories.find((c) => c.toLowerCase() === out.toLowerCase()) ?? null);
}
