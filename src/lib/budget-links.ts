import { getDb } from "./db";

// A budget link ties a category to the thing it funds: a savings goal, subscription, bill, debt
// account or investment account (the categories table carries one foreign-key column per type).
// Shared by the savings-goals route, the generic /api/budget-links endpoint and anything else that
// needs to read or move these links, so every page links and unlinks the same way.

export const LINK_COLUMNS = {
  savings_goal: "savings_goal_id",
  subscription: "subscription_id",
  bill: "bill_id",
  debt_account: "debt_account_id",
  investment_account: "investment_account_id",
} as const;

export type LinkType = keyof typeof LINK_COLUMNS;

export function isLinkType(v: string): v is LinkType {
  return v in LINK_COLUMNS;
}

// The category currently linked to the given target (first one when several point at it).
export function getBudgetLink(
  db: ReturnType<typeof getDb>,
  type: LinkType,
  targetId: string | number
): { category_id: number; category_name: string; group_name: string } | null {
  const column = LINK_COLUMNS[type];
  const row = db
    .prepare(`SELECT id AS category_id, name AS category_name, COALESCE(group_name, '') AS group_name FROM categories WHERE ${column} = ? LIMIT 1`)
    .get(targetId) as { category_id: number; category_name: string; group_name: string } | undefined;
  return row ?? null;
}

// Point the link at the picked category: clear every previous link for this target, then set the
// new one when a category id was given. Null/empty unlinks. Returns whether a link was set.
export function setBudgetLink(
  db: ReturnType<typeof getDb>,
  type: LinkType,
  targetId: string | number,
  categoryId: unknown
): boolean {
  const column = LINK_COLUMNS[type];
  db.prepare(`UPDATE categories SET ${column} = NULL WHERE ${column} = ?`).run(targetId);
  const catId = parseInt(String(categoryId ?? ""), 10);
  if (catId > 0) {
    db.prepare(`UPDATE categories SET ${column} = ? WHERE id = ?`).run(targetId, catId);
    console.info("[budget-links] Linked", type, targetId, "to category", catId);
    return true;
  }
  console.info("[budget-links] Unlinked", type, targetId, "from budget");
  return false;
}
