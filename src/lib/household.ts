import { getDb } from "./db";

export function getHouseholdSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM household_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setHouseholdSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO household_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, value);
  console.info("[household] Setting saved:", key);
}

export function getHouseholdSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM household_settings").all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// Convenience getters
export function getYnabToken(): string | null {
  return getHouseholdSetting("ynab_access_token");
}

export function getYnabBudgetId(): string | null {
  return getHouseholdSetting("ynab_budget_id");
}

// Data source mode: "ynab" when a YNAB token and budget are configured,
// otherwise "local" (Dough owns the data, Synci or manual entry feeds it).
export type BudgetMode = "ynab" | "local";

export function getBudgetMode(): BudgetMode {
  const token = getHouseholdSetting("ynab_access_token");
  const budgetId = getHouseholdSetting("ynab_budget_id");
  return token && budgetId ? "ynab" : "local";
}

export function isYnabConnected(): boolean {
  return getBudgetMode() === "ynab";
}

export function getSavingRate(): number {
  const val = getHouseholdSetting("saving_rate");
  return val ? parseFloat(val) : 0;
}

export function getSavingRateType(): "percent" | "fixed" {
  return (getHouseholdSetting("saving_rate_type") as "percent" | "fixed") || "fixed";
}
