import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";

// Cloudflare replaces an origin's 502 or 504 body with its own page, so the reason never reaches the app.
test("no route answers 502 or 504", () => {
  const found = spawnSync("grep", ["-rnE", "status: 50[24]\\b", "src/app/api"], { encoding: "utf8" }).stdout.trim();
  assert.equal(found, "");
});
