import { timingSafeEqual } from "crypto";
import { getDb } from "./db";
import { SECRET_SETTINGS, openSecret, sealSecret } from "./secrets";

// Constant-time string comparison for secrets (cron header vs stored value), so the comparison
// time does not leak how many leading characters match. Returns false for empty/missing values.
export function secretsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function getHouseholdSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM household_settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return null;
  return SECRET_SETTINGS.has(key) ? openSecret(row.value) : row.value;
}

export function setHouseholdSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO household_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, SECRET_SETTINGS.has(key) ? sealSecret(value) : value);
  console.info("[household] Setting saved:", key);
}

export function getHouseholdSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM household_settings").all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = SECRET_SETTINGS.has(row.key) ? openSecret(row.value) : row.value;
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

// The settings a member may change from the web app. Everything else in household_settings is kept
// by the server itself (the month's AI spend, sync state), so a request can never rewrite it.
export const WRITABLE_SETTINGS = new Set([
  "ai_model_categorize", "ai_model_chat", "ai_model_vision", "ai_model_insight", "ai_summaries_disabled",
  "anthropic_api_key", "gemini_api_key",
  "budget_excluded_accounts", "budget_group_order", "budget_include_bills", "budget_threshold_good",
  "budget_threshold_normal", "budget_threshold_tight", "burn_rate_excluded_payees", "last_reservation_month",
  "reserve_next_month_saving", "saving_rate",
  "date_format", "decimal_places", "time_format", "household_profile", "household_size",
  "prompt_chat_guidelines", "prompt_summary_instructions", "prompt_debt_instructions",
  "synci_account_mapping", "synci_accounts", "synci_api_token",
  "ynab_access_token", "ynab_budget_id", "ynab_refresh_token", "ynab_sync_hour", "ynab_token_expires_at",
]);
