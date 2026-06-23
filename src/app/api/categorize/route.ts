import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { categorizePayee } from "@/lib/ai/categorize";
import { categoryByPayeeAmount } from "@/lib/categorize-history";

// Guess the best budget category for a payee, so the add-expense modal can show the pick for the
// user to confirm or correct before saving. A consistent payee+amount history wins (fixed recurring
// payments), otherwise the AI guesses from the payee/description.
export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const payee = params.get("payee") || "";
    const memo = (params.get("memo") || "").trim();
    const amount = parseFloat(params.get("amount") || "");
    if (!payee.trim()) return NextResponse.json({ category: "" });

    const db = getDb();

    // A fixed payee+amount that has always been filed the same way is a stronger, instant signal
    // than the AI guess (e.g. Apple 11.99 -> Subscriptions), so use it first when an amount is known.
    if (isFinite(amount)) {
      const hist = categoryByPayeeAmount(db, payee, amount);
      if (hist) {
        console.debug("[categorize] payee+amount history", payee, amount, "->", hist);
        return NextResponse.json({ category: hist, source: "history" });
      }
    }

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
