const TRANSFER_PAYEES = ["Transfer", "Starting Balance", "Reconciliation Balance Adjustment"];

// Canonical category stored on internal-transfer transactions. Stored language-agnostically and
// shown via transferCategoryLabel(), so the displayed label follows the user's locale.
export const INTERNAL_TRANSFER_CATEGORY = "Internal transfer";

export function isTransfer(payee: string, category?: string): boolean {
  if (TRANSFER_PAYEES.some((p) => payee.startsWith(p))) return true;
  if (category === "Uncategorized") return true;
  // A transaction marked as an internal transfer (manually or by Synci pairing) carries this
  // category even when its payee is a normal name, so recognise it here too.
  if (category === INTERNAL_TRANSFER_CATEGORY) return true;
  return false;
}

// Localised label for the internal-transfer category (works for every supported language).
export function transferCategoryLabel(locale: string): string {
  return locale === "fi" ? "Sisäinen siirto" : "Internal transfer";
}
