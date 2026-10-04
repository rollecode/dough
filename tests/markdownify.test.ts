import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownify } from "@/lib/markdownify";

test("Dougie's bits of HTML become Markdown, as the iPhone app reads them", () => {
  assert.equal(markdownify("Today <b>-12,50 €</b> and <STRONG>45,00 €</STRONG>"), "Today **-12,50 €** and **45,00 €**");
  assert.equal(markdownify("a<br>b<br />c"), "a\nb\nc");
  assert.equal(markdownify('<a href="#expense">9,00 €</a>'), "[9,00 €](#expense)");
  assert.equal(markdownify("<ul><li>one</li></ul>"), "\n- one\n\n");
  assert.equal(markdownify("<span class='x'>kept</span> <script>x</script>"), "kept x");
  assert.equal(markdownify("plain **markdown** stays"), "plain **markdown** stays");
});
