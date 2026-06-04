import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

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

    const body = await request.json();
    const name = (body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const type = (body.type || "checking").trim();
    const balance = isFinite(Number(body.balance)) ? Math.round(Number(body.balance) * 100) / 100 : 0;
    const onBudget = body.on_budget === false ? 0 : 1;
    const id = `local_${randomUUID()}`;

    const db = getDb();
    const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM ynab_accounts").get() as { m: number }).m;
    db.prepare(
      "INSERT INTO ynab_accounts (id, name, type, balance, cleared_balance, on_budget, closed, source, sort_order, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, 0, 'manual', ?, datetime('now'))"
    ).run(id, name, type, balance, balance, onBudget, maxOrder + 1);

    console.info("[accounts] Created manual account", name, id);
    eventBus.emit("data:updated", { source: "accounts-added" });
    return NextResponse.json({ id });
  } catch (error) {
    console.error("[accounts] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const id = body.id;
    if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

    const db = getDb();
    const updates: string[] = [];
    const values: (string | number)[] = [];
    if (body.name !== undefined) { updates.push("name = ?"); values.push(String(body.name).trim()); }
    if (body.type !== undefined) { updates.push("type = ?"); values.push(String(body.type).trim()); }
    if (body.balance !== undefined) {
      const bal = Math.round(Number(body.balance) * 100) / 100;
      updates.push("balance = ?"); values.push(bal);
      updates.push("cleared_balance = ?"); values.push(bal);
    }
    if (body.on_budget !== undefined) { updates.push("on_budget = ?"); values.push(body.on_budget ? 1 : 0); }
    if (body.closed !== undefined) { updates.push("closed = ?"); values.push(body.closed ? 1 : 0); }
    if (body.sort_order !== undefined) { updates.push("sort_order = ?"); values.push(parseInt(String(body.sort_order), 10) || 0); }
    if (updates.length === 0) return NextResponse.json({ success: true });

    updates.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE ynab_accounts SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    console.info("[accounts] Updated account", id);
    eventBus.emit("data:updated", { source: "accounts-updated" });
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

    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

    const db = getDb();
    const acct = db.prepare("SELECT source FROM ynab_accounts WHERE id = ?").get(id) as { source: string } | undefined;
    if (!acct) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Only manually-created accounts can be hard-deleted; others are just closed
    if (acct.source === "manual") {
      db.prepare("DELETE FROM ynab_accounts WHERE id = ?").run(id);
      console.info("[accounts] Deleted manual account", id);
    } else {
      db.prepare("UPDATE ynab_accounts SET closed = 1, updated_at = datetime('now') WHERE id = ?").run(id);
      console.info("[accounts] Closed account", id);
    }

    eventBus.emit("data:updated", { source: "accounts-deleted" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[accounts] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
