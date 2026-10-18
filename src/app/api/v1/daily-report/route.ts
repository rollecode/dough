import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { reportResponse } from "@/lib/daily-report";

// GET /api/v1/daily-report?date=YYYY-MM-DD&locale=fi - the end-of-day report, written on first ask.
// Without a date: today from 18:00, yesterday before it. POST with { date?, locale? } writes it anew,
// for when the bank's transactions for that day arrived after the report was written.
async function respond(userId: number, date: string | null, locale: string | null, regenerate: boolean) {
  try {
    const result = await reportResponse(userId, date, locale, regenerate);
    return "error" in result ? NextResponse.json(result, { status: 400 }) : result;
  } catch (error) {
    // Why the AI could not write it (not signed in, the month's allowance used up), as receipts do.
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[api/v1/daily-report] Writing failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export const GET = apiRoute("read", (request, identity) => {
  const url = new URL(request.url);
  return respond(identity.userId, url.searchParams.get("date"), url.searchParams.get("locale"), false);
});

export const POST = apiRoute("write", async (request, identity) => {
  const body = await request.json().catch(() => ({}));
  return respond(identity.userId, body.date ?? null, body.locale ?? null, true);
});
