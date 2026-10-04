// Dougie answers in Markdown and sometimes in a little HTML. The chat renders Markdown only, so the
// HTML is turned into its Markdown equivalent first, the same mapping the iPhone app uses.
const REPLACEMENTS: [RegExp, string][] = [
  [/<br\s*\/?>/gi, "\n"],
  [/<\/p>/gi, "\n\n"], [/<p>/gi, ""],
  [/<\/?(ul|ol)>/gi, "\n"],
  [/<li>/gi, "- "], [/<\/li>/gi, "\n"],
  [/<\/?(strong|b)>/gi, "**"],
  [/<\/?(em|i)>/gi, "*"],
  [/<\/?code>/gi, "`"],
  [/<h1>/gi, "# "], [/<h2>/gi, "## "], [/<h3>/gi, "### "], [/<\/h[1-3]>/gi, "\n"],
];

export function markdownify(source: string): string {
  let text = source;
  for (const [tag, markdown] of REPLACEMENTS) {
    text = text.replace(tag, markdown);
  }
  // <a href="x">y</a> becomes [y](x); any other tag is dropped rather than shown.
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, "");
}
