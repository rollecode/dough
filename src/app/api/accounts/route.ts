import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createAccount, updateAccount, deleteAccount } from "@/lib/accounts-write";

interface AccountRow {
  id: string;
  name: string;
  type: string;
  balance: number;
  cleared_balance: number;
  on_budget: number;
  closed: number;
  source: string;
  synci_account_id: string;
  sort_order: number;
}

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ accounts: [] }, { status: 401 });

    const db = getDb();
    const accounts = db
      .prepare(
        "SELECT id, name, type, balance, cleared_balance, on_budget, closed, source, synci_account_id, sort_order " +
          "FROM ynab_accounts ORDER BY closed, sort_order, name"
      )
      .all() as AccountRow[];

    console.debug("[accounts] Loaded", accounts.length, "accounts");
    return NextResponse.json({ accounts });
  } catch (error) {
    console.error("[accounts] GET error:", error);
    return NextResponse.json({ accounts: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const result = createAccount(user.id, body);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("[accounts] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    const result = updateAccount(user.id, body);
    if (!result.found) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[accounts] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    const result = deleteAccount(String(body.id));
    if (!result.found) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[accounts] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
