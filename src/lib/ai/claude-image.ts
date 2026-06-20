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
      if (stderr.trim()) console.error("[claude-image] stderr:", stderr.trim());

      // Parse stream-json output for the result line. The CLI emits a result even when it fails
      // (e.g. an auth/API error) and then exits non-zero, so we read it regardless of the exit code
      // to surface the real reason ("Failed to authenticate", a 401, etc.) instead of a bare code.
      const lines = stdout.split("\n").filter(Boolean);
      let resultText = "";
      let resultError = "";
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "result") {
            if (parsed.is_error || parsed.api_error_status) {
              resultError = (typeof parsed.result === "string" && parsed.result.trim())
                || `Claude API error${parsed.api_error_status ? ` ${parsed.api_error_status}` : ""}`;
            } else if (parsed.result) {
              resultText = String(parsed.result).trim();
            }
          }
        } catch {
          // skip non-JSON lines
        }
      }

      if (resultText) {
        console.info("[claude-image] Got result, length:", resultText.length);
        resolve({ text: resultText });
        return;
      }
      if (resultError) {
        console.error("[claude-image] Result error:", resultError);
        resolve({ text: "", error: resultError });
        return;
      }
      if (code !== 0) {
        console.error("[claude-image] CLI exited with code", code);
        resolve({ text: "", error: `Claude exited with code ${code}` });
        return;
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
