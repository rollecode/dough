import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getHouseholdSetting, setHouseholdSetting } from "@/lib/household";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const token = getHouseholdSetting("synci_api_token");
    if (!token) {
      return NextResponse.json({ error: "Synci API token not configured" }, { status: 400 });
    }

    console.info("[synci/accounts] Fetching accounts from Synci API");

    const res = await fetch("https://api.synci.io/api/v1/banks/accounts", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[synci/accounts] API error:", res.status, text);
      return NextResponse.json({ error: "Synci API error" }, { status: res.status });
    }

    const data = await res.json();
    const accounts = (data.data || [])
      .filter((a: { enabled: boolean; iban: string }) => a.enabled && a.iban && !a.iban.includes("***"))
      .map((a: { id: number; iban: string; owner_name: string; currency: string; name: string | null; custom_name: string | null }) => ({
        id: String(a.id),
        iban: a.iban,
        owner: a.owner_name || "Unknown",
        currency: a.currency,
        name: a.name || "",
        customName: a.custom_name || "",
      }));

    // Save accounts list to settings for reference
    setHouseholdSetting("synci_accounts", JSON.stringify(accounts));

    console.info("[synci/accounts] Found", accounts.length, "accounts");
    return NextResponse.json({ accounts });
  } catch (error) {
    console.error("[synci/accounts] Error:", error);
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
  }
}
