import { getDb } from "@/lib/db";
import { generateApiKey } from "@/lib/api-auth";

// Dougie acts through the household's own MCP server, signed in as the person it is answering, so
// it can do exactly what that person could do through the API and nothing more. The key exists only
// for one answer.
//
// Never offered: anything that deletes or merges, rewrites account balances, settings or the rules
// later syncs follow, or moves the whole budget at once, because a payee or memo written to look like
// an instruction must not be able to do lasting damage. Nor Dougie asking itself.
export const DOUGIE_DENIED = [
  "dough_delete_transaction", "dough_delete_bill", "dough_delete_subscription", "dough_delete_savings_goal",
  "dough_delete_account", "dough_delete_category", "dough_delete_income", "dough_delete_payee_match",
  "dough_delete_my_account", "dough_merge_payees", "dough_ask_dougie",
  "dough_create_account", "dough_update_account", "dough_reconcile_account", "dough_update_settings",
  "dough_update_profile", "dough_add_payee_match", "dough_set_budget_link", "dough_auto_assign_apply",
  "dough_reorder_accounts", "dough_reorder_categories", "dough_reorder_debts", "dough_reorder_investments",
];

export async function withDougieTools<T>(userId: number, origin: string, run: (args: string[]) => Promise<T>): Promise<T> {
  const db = getDb();
  const { key, prefix, hash } = generateApiKey();
  const row = db.prepare("INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes) VALUES (?, ?, ?, ?, ?)")
    .run(userId, "Dougie, one answer", prefix, hash, "read,write");
  const config = { mcpServers: { dough: { type: "http", url: `${origin}/mcp`, headers: { Authorization: `Bearer ${key}` } } } };
  try {
    return await run([
      "--mcp-config", JSON.stringify(config),
      "--allowedTools", "mcp__dough",
      "--disallowedTools", ...DOUGIE_DENIED.map((name) => `mcp__dough__${name}`),
    ]);
  } finally {
    db.prepare("DELETE FROM api_keys WHERE id = ?").run(row.lastInsertRowid);
  }
}
