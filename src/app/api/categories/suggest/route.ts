import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

// Categories most often used for a given payee and/or description, derived from transaction
// history. A payee match is weighted higher than a description match, then ties break on recency.
// Used to surface the likely categories at the top of the picker so re-categorising is quick.
export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ categories: [] }, { status: 401 });

    const url = new URL(request.url);
    const payee = (url.searchParams.get("payee") || "").trim();
    const memo = (url.searchParams.get("memo") || "").trim();
    if (!payee && !memo) return NextResponse.json({ categories: [] });

    const db = getDb();
    const rows = db
      .prepare(
        "SELECT category, " +
          "SUM((CASE WHEN payee = ? THEN 3 ELSE 0 END) + (CASE WHEN ? <> '' AND memo = ? THEN 1 ELSE 0 END)) AS score, " +
          "MAX(date) AS recent " +
          "FROM transactions " +
          "WHERE COALESCE(category, '') NOT IN ('', 'Internal transfer', 'Inflow: Ready to Assign', 'Uncategorized') " +
          "AND (payee = ? OR (? <> '' AND memo = ?)) " +
          "GROUP BY category HAVING score > 0 ORDER BY score DESC, recent DESC LIMIT 6"
      )
      .all(payee, memo, memo, payee, memo, memo) as { category: string; score: number; recent: string }[];

    return NextResponse.json({ categories: rows.map((r) => r.category) });
  } catch (error) {
    console.error("[categories/suggest] error:", error);
    return NextResponse.json({ categories: [] }, { status: 500 });
  }
}
