import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getHouseholdSettings, setHouseholdSetting } from "@/lib/household";
import { eventBus } from "@/lib/event-bus";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const settings = getHouseholdSettings();
    console.debug("[household] Loaded settings:", Object.keys(settings).length, "keys");

    return NextResponse.json({
      settings: {
        ynab_connected: !!settings.ynab_access_token,
        data_mode: settings.ynab_access_token && settings.ynab_budget_id ? "ynab" : "local",
        synci_connected: !!settings.synci_api_token,
        ynab_budget_id: settings.ynab_budget_id || null,
        saving_rate: settings.saving_rate ? parseFloat(settings.saving_rate) : 0,
        saving_rate_type: settings.saving_rate_type || "fixed",
        household_profile: settings.household_profile || "",
        household_size: settings.household_size || "1",
        prompt_chat_guidelines: settings.prompt_chat_guidelines || "",
        prompt_summary_instructions: settings.prompt_summary_instructions || "",
        prompt_debt_instructions: settings.prompt_debt_instructions || "",
        last_ynab_sync: settings.last_ynab_sync || null,
        decimal_places: settings.decimal_places,
        date_format: settings.date_format || "d.m.yyyy",
        time_format: settings.time_format || "24h",
        budget_excluded_accounts: settings.budget_excluded_accounts || "[]",
        budget_include_bills: settings.budget_include_bills || "1",
        reserve_next_month_saving: settings.reserve_next_month_saving || "0",
        last_reservation_month: settings.last_reservation_month || "",
        ynab_sync_hour: settings.ynab_sync_hour || "6",
        ai_summaries_disabled: settings.ai_summaries_disabled || "0",
        budget_threshold_tight: settings.budget_threshold_tight || "20",
        budget_threshold_normal: settings.budget_threshold_normal || "30",
        budget_threshold_good: settings.budget_threshold_good || "50",
        budget_mode: settings.budget_mode || "rolling",
        synci_api_token: settings.synci_api_token ? "••••••••" : null,
        synci_accounts: settings.synci_accounts || null,
        synci_account_mapping: settings.synci_account_mapping || null,
        synci_last_sync: settings.synci_last_sync || null,
      },
    });
  } catch (error) {
    console.error("[household] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    console.info("[household] Updating settings:", Object.keys(body));

    for (const [key, value] of Object.entries(body)) {
      if (value === null || value === "") {
        // Delete the setting
        const { getDb } = await import("@/lib/db");
        getDb().prepare("DELETE FROM household_settings WHERE key = ?").run(key);
        console.info("[household] Deleted setting:", key);
      } else {
        setHouseholdSetting(key, String(value));
      }
    }

    eventBus.emit("data:updated", { source: "settings-changed" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[household] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
