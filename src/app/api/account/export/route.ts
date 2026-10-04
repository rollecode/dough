import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { exportResponse } from "@/lib/account";

// GET /api/account/export - the household's data as a SQLite file.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return exportResponse("with-credentials");
}
