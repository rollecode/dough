import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { payeeUsage } from "@/lib/payees";

// Distinct payees from existing transactions, most-used first, for autocompleting the payee
// field on the new-transaction form. Transfers, starting balances and reconciliations are
// excluded since they are not things a user types by hand.
export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const rows = payeeUsage(500);
    // usage carries the counts the payees dialog shows; payees stays a plain list for autocomplete.
    return NextResponse.json({ payees: rows.map((r) => r.payee), usage: rows.map((r) => ({ payee: r.payee, uses: r.uses })) });
  } catch (err) {
    console.error("[api/payees] error:", err);
    return NextResponse.json({ payees: [] });
  }
}
