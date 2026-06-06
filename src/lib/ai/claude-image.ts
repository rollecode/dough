import { spawn } from "child_process";
import { getAiModel } from "./model";

interface ClaudeImageResult {
  text: string;
  error?: string;
}

/**
 * Send an image + text prompt to Claude CLI via stream-json format.
 * Reuses the same CLI and auth as all other AI features.
 */
export async function queryClaudeWithImage(
  textPrompt: string,
  imageBase64: string,
  mediaType: string,
  timeoutMs = 60000
): Promise<ClaudeImageResult> {
  const claudePath = process.env.CLAUDE_PATH || "claude";

  const isPdf = mediaType === "application/pdf";
  const message = JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: isPdf ? "document" : "image",
          source: { type: "base64", media_type: mediaType, data: imageBase64 },
        },
        { type: "text", text: textPrompt },
      ],
    },
  });

  console.debug("[claude-image] Sending image prompt, text length:", textPrompt.length, "image size:", Math.round(imageBase64.length / 1024), "KB");

  const visionModel = getAiModel("vision");
  console.debug("[claude-image] Vision model:", visionModel);
  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, ["-p", "--model", visionModel, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"], {
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli" },
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code: number) => {
      if (code !== 0) {
        console.error("[claude-image] CLI exited with code", code, stderr);
        resolve({ text: "", error: `Claude exited with code ${code}` });
        return;
      }

      // Parse stream-json output to find the result
      const lines = stdout.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "result" && parsed.result) {
            console.info("[claude-image] Got result, length:", parsed.result.length);
            resolve({ text: parsed.result.trim() });
            return;
          }
        } catch {
          // skip non-JSON lines
        }
      }

      console.warn("[claude-image] No result found in output");
      resolve({ text: "", error: "No result in output" });
    });

    proc.on("error", (err) => {
      console.error("[claude-image] Process error:", err);
      reject(err);
    });

    proc.stdin.write(message);
    proc.stdin.end();
  });
}
