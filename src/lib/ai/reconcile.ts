import { spawn } from "child_process";
import { getAiModel, isGeminiModel, getGeminiKey } from "./model";
import { geminiText } from "./gemini";

export interface ReconcileTx {
  id: string;
  date: string;
  payee: string;
  amount: number;
}

export interface ReconcileResult {
  explanation: string;
  duplicateIds: string[];
}

// Ask the AI to explain why a recorded account balance differs from the real bank balance, using
// the last few days of transactions. Returns a short human explanation and the ids of any
// transactions that look like duplicates to remove. Uses the Claude CLI (subscription-covered),
// falling back to Gemini if the CLI is unavailable.
export async function explainReconcile(
  storedBalance: number,
  trueBalance: number,
  diff: number,
  txns: ReconcileTx[],
  locale: string
): Promise<ReconcileResult> {
  const lang = locale === "fi" ? "Vastaa suomeksi." : "Respond in English.";
  const dir = diff > 0
    ? (locale === "fi" ? `liian pieni ${Math.abs(diff).toFixed(2)} €` : `too low by ${Math.abs(diff).toFixed(2)} €`)
    : (locale === "fi" ? `liian suuri ${Math.abs(diff).toFixed(2)} €` : `too high by ${Math.abs(diff).toFixed(2)} €`);
  const list = txns.map((t) => `${t.id} | ${t.date} | ${t.payee} | ${t.amount.toFixed(2)} €`).join("\n");

  const prompt = `You are reconciling a personal-finance account. The app's recorded balance is ${storedBalance.toFixed(2)} €, the real bank balance is ${trueBalance.toFixed(2)} €, so the app's balance is ${dir}.
Transactions from the last 7 days (id | date | payee | amount):
${list || "(none)"}

Work out the most likely reason for the difference:
- If some of the listed transactions are duplicates (the same amount with a similar payee around the same date appearing more than once), put their ids in duplicateIds so they can be removed.
- Otherwise it is likely missing entries: state roughly how much is missing and whether it looks like a missing expense (app balance too high) or missing income / a double-counted expense (app balance too low).
Keep the explanation to 1-3 short, plain sentences a normal person understands. ${lang}
Reply with ONLY valid JSON, no markdown fences: {"explanation":"...","duplicateIds":["id",...]}
Only include ids that appear in the list above. Use an empty array when nothing looks like a duplicate.`;

  let raw: string | null = null;
  const model = getAiModel("chat");
  const cliModel = isGeminiModel(model) ? "sonnet" : model;
  const claudePath = process.env.CLAUDE_PATH || "claude";
  try {
    raw = await new Promise<string>((resolve, reject) => {
      const proc = spawn(claudePath, ["-p", "--model", cliModel, "-"], {
        timeout: 60000,
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli" },
      });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (code: number) => { if (code === 0 && stdout.trim()) resolve(stdout.trim()); else reject(new Error(stderr || "reconcile ai failed")); });
      proc.on("error", reject);
      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  } catch (err) {
    console.warn("[ai/reconcile] CLI failed, falling back to Gemini:", err);
    const key = getGeminiKey();
    if (key) raw = await geminiText(prompt, key, "gemini-2.5-flash", 400);
  }

  if (!raw) return { explanation: "", duplicateIds: [] };
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      const ids = Array.isArray(parsed.duplicateIds) ? parsed.duplicateIds.map((x: unknown) => String(x)) : [];
      return { explanation: String(parsed.explanation || ""), duplicateIds: ids };
    }
  } catch (err) {
    console.warn("[ai/reconcile] JSON parse failed:", err);
  }
  return { explanation: raw.slice(0, 400), duplicateIds: [] };
}
