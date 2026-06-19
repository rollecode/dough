import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ageOfMoneyData } from "@/lib/budget-math";

// Lightweight Age of Money for the dashboard. In YNAB mode this is YNAB's own per-month figure with
// its history; in local mode it is the live local runway (the stored YNAB figure is stale). See
// ageOfMoneyData for the mode-aware logic shared with the budget route.
export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = getDb();
    const { ageOfMoney, history } = ageOfMoneyData(db);
    return NextResponse.json({ ageOfMoney, history });
  } catch (error) {
    console.error("[age-of-money] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
