import { ynabToken } from "@/lib/ynab/oauth";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getYnabToken } from "@/lib/household";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // The household's token; the old per-user column is emptied when it moves there.
    const token = await ynabToken();
    if (!token) {
      return NextResponse.json({ error: "YNAB not connected" }, { status: 400 });
    }

    console.info("[api/ynab/budgets] Fetching budgets for user", user.id);

    const res = await fetch("https://api.ynab.com/v1/budgets", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error("[api/ynab/budgets] YNAB API error:", res.status, await res.text());
      return NextResponse.json({ error: "YNAB API error" }, { status: res.status });
    }

    const data = await res.json();
    const budgets = (data.data?.budgets ?? []).map((b: { id: string; name: string }) => ({
      id: b.id,
      name: b.name,
    }));

    console.info("[api/ynab/budgets] Found", budgets.length, "budgets");
    return NextResponse.json({ budgets });
  } catch (error) {
    console.error("[api/ynab/budgets] Error:", error);
    return NextResponse.json({ error: "Failed to fetch budgets" }, { status: 500 });
  }
}
