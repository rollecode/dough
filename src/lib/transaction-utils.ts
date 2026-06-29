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

// Normalise a payee for transfer-payee matching: lowercased, whitespace-collapsed and its name
// tokens sorted, so a reordered name (surname-first vs first-name-first) still matches. Used as the
// learning key for both the internal-transfer payee list and the payee -> counterpart-account map,
// so the sync importer and the edit dialog must normalise identically.
export function normTransferPayee(p: string): string {
  return p.toLowerCase().trim().split(/\s+/).filter(Boolean).sort().join(" ");
}

// True for generic transfer-leg descriptors ("Transfer : X", "Siirto", "Starting balance", ...)
// that must never be learned as a real person/payee key.
export function isGenericTransferPayee(p: string): boolean {
  return /^(transfer|siirto|starting balance|reconciliation)/i.test(p.trim());
}
