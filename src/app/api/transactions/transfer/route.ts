import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBudgetMode } from "@/lib/household";
import { eventBus } from "@/lib/event-bus";
import { localDateIso } from "@/lib/date-utils";
import { INTERNAL_TRANSFER_CATEGORY } from "@/lib/transaction-utils";

// Add an internal transfer between two own accounts: two opposite rows labelled
// "Transfer : <other account>" with the internal-transfer category, mirroring how Synci stores a
// paired transfer. Excluded from spending/income via isTransfer(). Local mode only - in YNAB mode
// transfers are managed in YNAB, so this declines rather than create bogus YNAB transactions.
export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    if (getBudgetMode() !== "local") {
      return NextResponse.json({ error: "Transfers are managed in YNAB when YNAB is connected" }, { status: 400 });
    }

    const body = await request.json();
    const fromId = String(body.from_account_id || "");
    const toId = String(body.to_account_id || "");
    const amt = Math.abs(parseFloat(String(body.amount).replace(",", ".")));
    const date = body.date || localDateIso();
    const memo = body.memo || "";

    if (!fromId || !toId || fromId === toId) {
      return NextResponse.json({ error: "Two different accounts required" }, { status: 400 });
    }
    if (!isFinite(amt) || amt <= 0) {
      return NextResponse.json({ error: "Amount required" }, { status: 400 });
    }

    const db = getDb();
    const names = new Map(
      (db.prepare("SELECT id, name FROM ynab_accounts").all() as { id: string; name: string }[]).map((a) => [a.id, a.name])
    );
    const fromName = names.get(fromId) || "";
    const toName = names.get(toId) || "";
    if (!fromName || !toName) return NextResponse.json({ error: "Unknown account" }, { status: 400 });

    const insert = db.prepare(`
      INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'cleared')
    `);
    const move = db.prepare("UPDATE ynab_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?");
    const run = db.transaction(() => {
      insert.run(user.id, `local_${randomUUID()}`, date, -amt, `Transfer : ${toName}`, INTERNAL_TRANSFER_CATEGORY, memo, fromId);
      insert.run(user.id, `local_${randomUUID()}`, date, amt, `Transfer : ${fromName}`, INTERNAL_TRANSFER_CATEGORY, memo, toId);
      move.run(-amt, fromId);
      move.run(amt, toId);
    });
    run();

    eventBus.emit("data:updated", { source: "transaction-added", userId: user.id });
    console.info("[transactions/transfer] Local transfer", amt, fromName, "->", toName);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[transactions/transfer] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
