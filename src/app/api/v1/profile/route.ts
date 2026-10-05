import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

// GET /api/v1/profile - who the key or token belongs to. The display name is what the dashboard
// greets by, so a client that can show the greeting can also set it.
export const GET = apiRoute("read", (_request, identity) => {
  const profile = getDb()
    .prepare(
      "SELECT id, email, COALESCE(display_name, '') AS display_name, COALESCE(locale, 'en') AS locale, " +
        "COALESCE(budget_share, 0) AS budget_share, default_transfer_from, default_transfer_to FROM users WHERE id = ?"
    )
    .get(identity.userId) as
    | {
        id: number; email: string; display_name: string; locale: string; budget_share: number;
        default_transfer_from: string | null; default_transfer_to: string | null;
      }
    | undefined;

  if (!profile) return NextResponse.json({ error: "No such user" }, { status: 404 });

  const linked = (
    getDb()
      .prepare("SELECT ynab_account_id FROM user_linked_accounts WHERE user_id = ?")
      .all(identity.userId) as { ynab_account_id: string }[]
  ).map((r) => r.ynab_account_id);

  return { profile, linked_account_ids: linked };
});

// POST /api/v1/profile { display_name?, budget_share?, default_transfer_from?, default_transfer_to? }
// - edit the asker's own profile. An empty or null account clears that default.
export const POST = apiRoute("write", async (request, identity) => {
  const body = await request.json().catch(() => ({}));
  const db = getDb();
  const written: string[] = [];

  if (body.display_name !== undefined) {
    db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(String(body.display_name), identity.userId);
    written.push("display_name");
  }

  if (body.budget_share !== undefined) {
    const share = Number(body.budget_share);
    if (!isFinite(share) || share < 0 || share > 100) {
      return NextResponse.json({ error: "budget_share must be between 0 and 100" }, { status: 400 });
    }
    db.prepare("UPDATE users SET budget_share = ? WHERE id = ?").run(share, identity.userId);
    written.push("budget_share");
  }

  for (const key of ["default_transfer_from", "default_transfer_to"] as const) {
    if (body[key] === undefined) continue;
    const id = body[key] ? String(body[key]) : null;
    if (id && !db.prepare("SELECT 1 FROM ynab_accounts WHERE id = ?").get(id)) {
      return NextResponse.json({ error: `${key} is not an account` }, { status: 400 });
    }
    db.prepare(`UPDATE users SET ${key} = ? WHERE id = ?`).run(id, identity.userId);
    written.push(key);
  }

  if (written.length === 0) {
    return NextResponse.json({ error: "display_name, budget_share, default_transfer_from or default_transfer_to required" }, { status: 400 });
  }

  eventBus.emit("data:updated", { source: "api-v1-profile" });
  return { success: true, written };
});
