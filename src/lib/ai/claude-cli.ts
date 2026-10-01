import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { getHouseholdSetting, setHouseholdSetting } from "@/lib/household";

// Prompts carry bank-derived text, so the CLI gets no tools, no MCP servers and no secrets of ours.
const LOCKDOWN_ARGS = ["--tools", "", "--strict-mcp-config", "--disable-slash-commands"];
const ENV_KEYS = ["HOME", "PATH", "USER", "LANG", "LC_ALL", "TZ", "TMPDIR", "XDG_CONFIG_HOME"];
const ENV_PREFIXES = ["ANTHROPIC_", "CLAUDE_"];

export function claudeArgs(args: string[]): string[] {
  return [...LOCKDOWN_ARGS, ...args];
}

export function claudeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { CLAUDE_CODE_ENTRYPOINT: "cli" };
  for (const [key, value] of Object.entries(process.env)) {
    if (ENV_KEYS.includes(key) || ENV_PREFIXES.some((p) => key.startsWith(p))) {
      env[key] = value;
    }
  }
  return env;
}

export function spawnClaude(args: string[], timeoutMs: number, extraEnv: Record<string, string> = {}): ChildProcessWithoutNullStreams {
  const claudePath = process.env.CLAUDE_PATH || "claude";
  console.debug("[claude-cli] Spawning", claudePath, args.join(" "));
  return spawn(claudePath, claudeArgs(args), { env: { ...claudeEnv(), ...extraEnv } as NodeJS.ProcessEnv, timeout: timeoutMs });
}

// Whose money a call spends. A household's own Anthropic key is theirs and is never metered. A
// hosted instance that sets DOUGH_AI_MONTHLY_CAP_USD lends the rest its own key up to that much a
// month each. Otherwise, as self-hosted, the CLI uses whatever it is signed in with.
export function aiBilling(): { env: Record<string, string>; capUsd: number | null } {
  const own = getHouseholdSetting("anthropic_api_key");
  if (own) return { env: { ANTHROPIC_API_KEY: own }, capUsd: null };
  const cap = parseFloat(process.env.DOUGH_AI_MONTHLY_CAP_USD || "");
  return { env: {}, capUsd: Number.isFinite(cap) ? cap : null };
}

const spendKey = () => `ai_spend:${new Date().toISOString().slice(0, 7)}`;

export function aiSpendThisMonth(): number {
  return parseFloat(getHouseholdSetting(spendKey()) || "0") || 0;
}

export function recordAiSpend(usd: number): void {
  if (usd > 0) setHouseholdSetting(spendKey(), String(aiSpendThisMonth() + usd));
}

// What is left of the month's allowance, or null when the call is not metered. Throws once it is
// spent, so every caller's own failure path tells the person instead of the call going through.
export function aiAllowanceLeft(capUsd: number | null): number | null {
  if (capUsd === null) return null;
  const left = capUsd - aiSpendThisMonth();
  if (left <= 0) throw new Error("This month's AI allowance is used up");
  return left;
}

// One prompt in, the answer's text out. Every text call goes through here so the key and the
// allowance are applied in one place.
export async function runClaude(model: string, prompt: string, timeoutMs: number, extraArgs: string[] = []): Promise<string> {
  const { env, capUsd } = aiBilling();
  const left = aiAllowanceLeft(capUsd);
  const args = ["-p", "--model", model, ...extraArgs];
  if (left !== null) args.push("--output-format", "json", "--max-budget-usd", left.toFixed(2));
  args.push("-");

  const stdout = await new Promise<string>((resolve, reject) => {
    const proc = spawnClaude(args, timeoutMs, env);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    proc.on("close", (code: number) => {
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(`claude exited with code ${code}: ${err}`));
    });
    proc.on("error", reject);
    proc.stdin.write(prompt);
    proc.stdin.end();
  });

  if (left === null) return stdout;
  const result = JSON.parse(stdout) as { result?: string; total_cost_usd?: number; is_error?: boolean };
  recordAiSpend(result.total_cost_usd ?? 0);
  if (result.is_error || !result.result) throw new Error("claude returned no result");
  return result.result.trim();
}
