import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { getHouseholdSetting, setHouseholdSetting } from "@/lib/household";
import { eventBus } from "@/lib/event-bus";

// POST /api/v1/accounts/flags (write) - the two things about an account that are not the account
// itself: whether the daily budget counts it, and whether it is the asker's own spending account.
// Body: { id, budget_excluded?, mine? }
export const POST = apiRoute("write", async (request, identity) => {
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM ynab_accounts WHERE id = ?").get(id);
  if (!exists) return NextResponse.json({ error: `No account with id ${id}` }, { status: 404 });

  if (typeof body.budget_excluded === "boolean") {
    let excluded: string[] = [];
    try {
      excluded = JSON.parse(getHouseholdSetting("budget_excluded_accounts") || "[]");
    } catch {
      console.warn("[api/v1/accounts/flags] budget_excluded_accounts is not valid JSON, starting over");
    }
    const next = body.budget_excluded
      ? [...new Set([...excluded, id])]
      : excluded.filter((a) => a !== id);
    setHouseholdSetting("budget_excluded_accounts", JSON.stringify(next));
  }

  if (typeof body.mine === "boolean") {
    if (body.mine) {
      db.prepare("INSERT OR IGNORE INTO user_linked_accounts (user_id, ynab_account_id) VALUES (?, ?)")
        .run(identity.userId, id);
    } else {
      db.prepare("DELETE FROM user_linked_accounts WHERE user_id = ? AND ynab_account_id = ?")
        .run(identity.userId, id);
    }
  }

  eventBus.emit("data:updated", { source: "api-v1-account-flags" });
  return { success: true, id };
});
