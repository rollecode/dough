import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

// Look for an existing transaction that a manual add would likely duplicate: same absolute
// amount, dated on the add date or the day after (Synci may have already imported it, or will
// import a still-pending one tomorrow). Non-blocking — the caller warns and lets the user decide.
export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const url = new URL(request.url);
    const amount = Math.abs(Number(url.searchParams.get("amount")));
    const date = url.searchParams.get("date") || "";
    if (!isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ duplicates: [] });
    }

    // End of window = the day after the add date (today + tomorrow).
    const end = new Date(`${date}T00:00:00`);
    end.setDate(end.getDate() + 1);
    const endStr = end.toISOString().slice(0, 10);

    const db = getDb();
    const rows = db
      .prepare(
        "SELECT t.id, t.date, t.payee, t.amount, t.created_at, COALESCE(acc.name, '') AS account " +
          "FROM transactions t LEFT JOIN ynab_accounts acc ON acc.id = t.account_id " +
          "WHERE ROUND(ABS(t.amount), 2) = ROUND(?, 2) AND t.date >= ? AND t.date <= ? " +
          "ORDER BY t.date DESC, t.id DESC LIMIT 5"
      )
      .all(amount, date, endStr) as { id: string; date: string; payee: string; amount: number; created_at: string; account: string }[];

    console.debug("[check-duplicate] amount", amount, "date", date, "->", rows.length, "candidates");
    return NextResponse.json({ duplicates: rows });
  } catch (error) {
    console.error("[check-duplicate] GET error:", error);
    return NextResponse.json({ duplicates: [] });
  }
}
