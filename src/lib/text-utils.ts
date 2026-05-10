/**
 * Normalize payee name to title case.
 * "STORE NAME" → "Store Name"
 * "store-name location" → "Store-Name Location"
 * Preserves known abbreviations and short words.
 */
export function titleCasePayee(name: string): string {
  if (!name) return name;
  return name
    .toLowerCase()
    .split(/(\s+|-)/g)
    .map((part) => {
      if (part.match(/^\s+$/) || part === "-") return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}
