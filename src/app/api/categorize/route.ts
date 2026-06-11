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

    const payee = new URL(request.url).searchParams.get("payee") || "";
    if (!payee.trim()) return NextResponse.json({ category: "" });

    const db = getDb();
    const names = (db.prepare("SELECT name FROM categories WHERE is_active = 1").all() as { name: string }[]).map((c) => c.name);
    if (names.length === 0) return NextResponse.json({ category: "" });

    const category = await categorizePayee(payee, names);
    console.debug("[categorize] payee", payee, "->", category);
    return NextResponse.json({ category: category || "" });
  } catch (error) {
    console.error("[categorize] error:", error);
    return NextResponse.json({ category: "" });
  }
}
