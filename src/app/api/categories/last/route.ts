import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

// Last expense to prefill the add form for a recurring entry. Prefers a match on the exact payee
// (recurring transactions repeat the same payee and amount); falls back to the most recent expense
// in the category when the payee has no history. Returns the absolute amount (the add form takes a
// positive number) and the last memo. Excludes transfers, starting balances and reconciliation rows.
export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const payee = (params.get("payee") || "").trim();
    const category = (params.get("category") || "").trim();
    if (!payee && !category) return NextResponse.json({ amount: null, memo: null });

    const db = getDb();
    const find = (clause: string, value: string) =>
      db.prepare(
        "SELECT amount, COALESCE(memo, '') AS memo FROM transactions " +
          `WHERE ${clause} AND amount < 0 AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' AND payee NOT LIKE 'Reconciliation%' ` +
          "ORDER BY date DESC, id DESC LIMIT 1"
      ).get(value) as { amount: number; memo: string } | undefined;

    let row = payee ? find("LOWER(payee) = LOWER(?)", payee) : undefined;
    let source = "payee";
    if (!row && category) { row = find("category = ?", category); source = "category"; }

    if (!row) {
      console.debug("[categories/last] no prior expense for payee", payee, "or category", category);
      return NextResponse.json({ amount: null, memo: null });
    }
    console.debug("[categories/last] matched by", source, "->", Math.abs(row.amount), row.memo ? "(memo)" : "");
    return NextResponse.json({ amount: Math.abs(row.amount), memo: row.memo });
  } catch (error) {
    console.error("[categories/last] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
