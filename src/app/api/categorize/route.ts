import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { guessCategory } from "@/lib/category-suggest";

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
    const guess = await guessCategory(getDb(), payee, memo, amount);
    console.debug("[categorize] payee", payee, "memo:", memo || "-", "->", guess.category, guess.source || "ai");
    return NextResponse.json(guess);
  } catch (error) {
    console.error("[categorize] error:", error);
    return NextResponse.json({ category: "" });
  }
}
