import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { getHouseholdSettings, setHouseholdSetting } from "@/lib/household";

// The household figures that shape the daily budget, readable and writable by a client so a phone
// can change a saving goal without opening the web app. Deliberately narrow: this is not a way to
// reach every setting, only the ones a person adjusts while looking at the day's number.
//
// burn_rate_excluded_payees is the one list: payees the burn rate leaves out, rent for example.
//
// Display preferences are not here. How many decimals a client shows is that client's business,
// and a phone changing the web app's formatting would be a surprise, not a feature.
const NUMBERS = [
  "saving_rate",
  "budget_threshold_tight",
  "budget_threshold_normal",
  "budget_threshold_good",
  "good_month_level",
  "daily_cap",
] as const;

function excludedPayees(raw: string | undefined): string[] {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export const GET = apiRoute("read", () => {
  const settings = getHouseholdSettings();
  return {
    saving_rate: parseFloat(settings.saving_rate || "0") || 0,
    saving_rate_type: settings.saving_rate_type || "fixed",
    budget_include_bills: settings.budget_include_bills || "auto",
    budget_threshold_tight: parseInt(settings.budget_threshold_tight || "20", 10),
    budget_threshold_normal: parseInt(settings.budget_threshold_normal || "30", 10),
    budget_threshold_good: parseInt(settings.budget_threshold_good || "50", 10),
    reserve_next_month_saving: settings.reserve_next_month_saving === "1",
    good_month_saving: settings.good_month_saving === "1",
    good_month_level: parseFloat(settings.good_month_level || "50") || 0,
    daily_cap_enabled: settings.daily_cap_enabled === "1",
    daily_cap: parseFloat(settings.daily_cap || "0") || 0,
    household_size: parseInt(settings.household_size || "1", 10),
    burn_rate_excluded_payees: excludedPayees(settings.burn_rate_excluded_payees),
  };
});

export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const written: string[] = [];

  for (const key of NUMBERS) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (!isFinite(value) || value < 0) {
      return NextResponse.json({ error: `${key} must be a number of at least 0` }, { status: 400 });
    }
    setHouseholdSetting(key, String(value));
    written.push(key);
  }

  if (body.budget_include_bills !== undefined) {
    const mode = String(body.budget_include_bills);
    if (!["auto", "1", "0"].includes(mode)) {
      return NextResponse.json({ error: "budget_include_bills must be auto, 1 or 0" }, { status: 400 });
    }
    setHouseholdSetting("budget_include_bills", mode);
    written.push("budget_include_bills");
  }

  if (body.reserve_next_month_saving !== undefined) {
    setHouseholdSetting("reserve_next_month_saving", body.reserve_next_month_saving ? "1" : "0");
    written.push("reserve_next_month_saving");
  }

  for (const key of ["good_month_saving", "daily_cap_enabled"] as const) {
    if (body[key] === undefined) continue;
    setHouseholdSetting(key, body[key] ? "1" : "0");
    written.push(key);
  }

  if (body.burn_rate_excluded_payees !== undefined) {
    if (!Array.isArray(body.burn_rate_excluded_payees) || body.burn_rate_excluded_payees.some((p: unknown) => typeof p !== "string")) {
      return NextResponse.json({ error: "burn_rate_excluded_payees must be a list of payee names" }, { status: 400 });
    }
    const names = body.burn_rate_excluded_payees.map((p: string) => p.trim()).filter(Boolean);
    setHouseholdSetting("burn_rate_excluded_payees", JSON.stringify(names));
    written.push("burn_rate_excluded_payees");
  }

  if (written.length === 0) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  }

  console.info("[v1/settings] Updated", written.join(", "));
  return { success: true, updated: written };
});
