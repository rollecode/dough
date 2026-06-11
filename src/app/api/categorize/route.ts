import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { categorizePayee } from "@/lib/ai/categorize";

// Guess the best budget category for a payee, so the add-expense modal can show the AI's pick for
// the user to confirm or correct before saving (instead of categorizing silently after the fact).
export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const payee = params.get("payee") || "";
    const memo = (params.get("memo") || "").trim();
    if (!payee.trim()) return NextResponse.json({ category: "" });

    const db = getDb();
    const names = (db.prepare("SELECT name FROM categories WHERE is_active = 1").all() as { name: string }[]).map((c) => c.name);
    if (names.length === 0) return NextResponse.json({ category: "" });

    // The description often disambiguates a generic payee, so include it in the context.
    const context = memo ? `${payee} (${memo})` : payee;
    const category = await categorizePayee(context, names);
    console.debug("[categorize] payee", payee, "memo:", memo || "-", "->", category);
    return NextResponse.json({ category: category || "" });
  } catch (error) {
    console.error("[categorize] error:", error);
    return NextResponse.json({ category: "" });
  }
}
