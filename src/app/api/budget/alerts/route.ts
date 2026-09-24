import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { localDateIso } from "@/lib/date-utils";
import { overspentCategories } from "@/lib/badges";

// Actionable budget state for the current month, used to show a notice dot on the Budjetti nav
// item: how many categories have gone overspent.
export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const overspent = overspentCategories(getDb(), localDateIso().slice(0, 7));
    console.info("[budget/alerts] overspent categories:", overspent);
    return NextResponse.json({ overspent });
  } catch (err) {
    console.error("[budget/alerts] error:", err);
    return NextResponse.json({ overspent: 0 });
  }
}
