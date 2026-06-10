import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

// Distinct payees from existing transactions, most-used first, for autocompleting the payee
// field on the new-transaction form. Transfers, starting balances and reconciliations are
// excluded since they are not things a user types by hand.
export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = getDb();
    const rows = db
      .prepare(
        "SELECT payee, COUNT(*) AS n FROM transactions " +
          "WHERE COALESCE(payee, '') <> '' AND payee NOT LIKE 'Transfer%' AND payee NOT LIKE 'Starting%' AND payee NOT LIKE 'Reconciliation%' " +
          "GROUP BY payee ORDER BY n DESC, MAX(date) DESC LIMIT 500"
      )
      .all() as { payee: string; n: number }[];

    return NextResponse.json({ payees: rows.map((r) => r.payee) });
  } catch (err) {
    console.error("[api/payees] error:", err);
    return NextResponse.json({ payees: [] });
  }
}
