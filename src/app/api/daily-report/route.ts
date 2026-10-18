import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { reportResponse } from "@/lib/daily-report";

// The web's end-of-day report: the same answer /api/v1/daily-report gives a phone.
async function respond(request: Request, regenerate: boolean) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const body = regenerate ? await request.json().catch(() => ({})) : {};
    const result = await reportResponse(
      user.id,
      body.date ?? url.searchParams.get("date"),
      body.locale ?? url.searchParams.get("locale"),
      regenerate
    );
    return NextResponse.json(result, { status: "error" in result ? 400 : 200 });
  } catch (error) {
    console.error("[daily-report] Failed:", error);
    const message = error instanceof Error ? error.message : "Failed to write the report";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export const GET = (request: Request) => respond(request, false);
export const POST = (request: Request) => respond(request, true);
