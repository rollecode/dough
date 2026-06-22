import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

// Most recent expense for a category, used to prefill the amount and description when adding a
// recurring transaction (pick the category, get the last cost and note ready to tweak). Returns the
// absolute amount (the add form takes a positive number) and the last memo. Excludes transfers,
// starting balances and reconciliation adjustments so the prefill reflects a real spend.
export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const category = (new URL(request.url).searchParams.get("category") || "").trim();
    if (!category) return NextResponse.json({ amount: null, memo: null });

    const db = getDb();
    const row = db.prepare(
      "SELECT amount, COALESCE(memo, '') AS memo FROM transactions " +
        "WHERE category = ? AND amount < 0 AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' AND payee NOT LIKE 'Reconciliation%' " +
        "ORDER BY date DESC, id DESC LIMIT 1"
    ).get(category) as { amount: number; memo: string } | undefined;

    if (!row) {
      console.debug("[categories/last] no prior expense for", category);
      return NextResponse.json({ amount: null, memo: null });
    }
    console.debug("[categories/last]", category, "->", Math.abs(row.amount), row.memo ? "(memo)" : "");
    return NextResponse.json({ amount: Math.abs(row.amount), memo: row.memo });
  } catch (error) {
    console.error("[categories/last] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
