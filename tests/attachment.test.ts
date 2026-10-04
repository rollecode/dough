import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentProblem } from "@/lib/ai/attachment";
import { routineAnswer } from "@/lib/ai/routine";

test("only photos and PDFs of a sane size are read", () => {
  assert.equal(attachmentProblem("aGVsbG8=", "image/jpeg"), null);
  assert.equal(attachmentProblem("aGVsbG8=", "application/pdf"), null);
  assert.match(attachmentProblem("aGVsbG8=", "text/html") ?? "", /JPEG, PNG, WebP or PDF/);
  assert.match(attachmentProblem("a".repeat(15_000_001), "image/png") ?? "", /too large/);
});

test("an unreadable attachment never reaches the AI", async () => {
  await assert.rejects(routineAnswer("vision", "read", { image: { data: "x", mediaType: "image/svg+xml" } }), /JPEG, PNG, WebP or PDF/);
});
