import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

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

export function spawnClaude(args: string[], timeoutMs: number): ChildProcessWithoutNullStreams {
  const claudePath = process.env.CLAUDE_PATH || "claude";
  console.debug("[claude-cli] Spawning", claudePath, args.join(" "));
  return spawn(claudePath, claudeArgs(args), { env: claudeEnv() as NodeJS.ProcessEnv, timeout: timeoutMs });
}
