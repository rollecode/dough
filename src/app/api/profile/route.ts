import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = getDb();
    const profile = db
      .prepare("SELECT id, email, display_name, locale, budget_share, default_transfer_from, default_transfer_to FROM users WHERE id = ?")
      .get(user.id) as {
        id: number; email: string; display_name: string; locale: string; budget_share: number;
        default_transfer_from: string | null; default_transfer_to: string | null;
      } | undefined;

    const linkedAccounts = db
      .prepare("SELECT ynab_account_id FROM user_linked_accounts WHERE user_id = ?")
      .all(user.id) as { ynab_account_id: string }[];

    console.debug("[profile] Loaded profile for user", user.id, "linked accounts:", linkedAccounts.length);

    return NextResponse.json({
      profile,
      linkedAccountIds: linkedAccounts.map((a) => a.ynab_account_id),
    });
  } catch (error) {
    console.error("[profile] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const db = getDb();

    if (body.display_name !== undefined) {
      console.info("[profile] Updating display name for user", user.id, "to", body.display_name);
      db.prepare("UPDATE users SET display_name = ?, updated_at = datetime('now') WHERE id = ?")
        .run(body.display_name, user.id);
    }

    if (body.budget_share !== undefined) {
      console.info("[profile] Updating budget share for user", user.id, "to", body.budget_share);
      db.prepare("UPDATE users SET budget_share = ?, updated_at = datetime('now') WHERE id = ?")
        .run(parseInt(body.budget_share, 10) || 0, user.id);
    }

    for (const key of ["default_transfer_from", "default_transfer_to"] as const) {
      if (body[key] === undefined) continue;
      db.prepare(`UPDATE users SET ${key} = ?, updated_at = datetime('now') WHERE id = ?`).run(body[key] ? String(body[key]) : null, user.id);
    }

    if (body.linked_account_ids !== undefined) {
      console.info("[profile] Updating linked accounts for user", user.id, "count:", body.linked_account_ids.length);
      db.prepare("DELETE FROM user_linked_accounts WHERE user_id = ?").run(user.id);
      const insert = db.prepare("INSERT INTO user_linked_accounts (user_id, ynab_account_id) VALUES (?, ?)");
      for (const accountId of body.linked_account_ids) {
        insert.run(user.id, accountId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[profile] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
