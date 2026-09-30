import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { suggestCategories } from "@/lib/category-suggest";

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

    return NextResponse.json({ categories: suggestCategories(getDb(), payee, memo) });
  } catch (error) {
    console.error("[categories/suggest] error:", error);
    return NextResponse.json({ categories: [] }, { status: 500 });
  }
}
