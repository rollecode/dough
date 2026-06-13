import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

// Distinct descriptions (memos) from existing transactions, most-used first, for autocompleting
// the description field on the transaction forms. Mirrors /api/payees for the payee field.
export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = getDb();
    const rows = db
      .prepare(
        "SELECT memo, COUNT(*) AS n FROM transactions " +
          "WHERE COALESCE(memo, '') <> '' " +
          "GROUP BY memo ORDER BY n DESC, MAX(date) DESC LIMIT 500"
      )
      .all() as { memo: string; n: number }[];

    return NextResponse.json({ memos: rows.map((r) => r.memo) });
  } catch (err) {
    console.error("[api/memos] error:", err);
    return NextResponse.json({ memos: [] });
  }
}
