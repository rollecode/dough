import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseReceipt } from "@/lib/ai/receipt";

test("a failed read passes the reason on instead of an empty list", async () => {
  const cli = join(mkdtempSync(join(tmpdir(), "fake-claude-")), "claude");
  writeFileSync(cli, `#!/bin/sh
cat > /dev/null
echo '{"type":"result","is_error":true,"result":"Not logged in"}'
exit 1
`);
  chmodSync(cli, 0o755);
  process.env.CLAUDE_PATH = cli;
  await assert.rejects(parseReceipt("aGVsbG8=", "image/png"), /Not logged in/);
  delete process.env.CLAUDE_PATH;
});
