import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { splitTransaction } from "@/lib/split-transaction";

// Split a transaction across categories. The work is in lib/split-transaction, which the v1 API
// calls too, so a browser and a phone split identically.
export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const result = splitTransaction(
      user.id,
      String(body.transaction_id || ""),
      Array.isArray(body.splits) ? body.splits : []
    );
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.code });
    }
    return NextResponse.json({ success: true, parts: result.parts });
  } catch (error) {
    console.error("[ynab/transaction/split] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
