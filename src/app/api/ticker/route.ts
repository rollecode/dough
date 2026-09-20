import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { tickerData } from "@/lib/ticker";

export async function GET(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const symbols = new URL(request.url).searchParams.get("symbols");
    if (!symbols) return NextResponse.json({ error: "symbols param required" }, { status: 400 });

    const tickers = await tickerData(symbols.split(","));
    console.debug("[ticker] Returning", Object.keys(tickers).length, "tickers");
    return NextResponse.json({ tickers });
  } catch (error) {
    console.error("[ticker] Error:", error);
    return NextResponse.json({ error: "Failed to fetch ticker data" }, { status: 500 });
  }
}
