import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";

interface TxRow {
  id: string;
  date: string;
  amount: number;
  payee: string;
  category: string;
  memo: string | null;
  account_id: string;
  account_name: string | null;
}

// GET /api/v1/transactions - transactions newest first. Filters (all optional):
//   month=YYYY-MM, account_id=<id>, category=<name>, q=<search payee/memo>, limit=<1..500, default 50>
export const GET = apiRoute("read", (request) => {
  const params = new URL(request.url).searchParams;
  const where: string[] = [];
  const args: (string | number)[] = [];

  const month = params.get("month");
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    where.push("t.date >= ? AND t.date <= ?");
    args.push(`${month}-01`, `${month}-31`);
  }
  const accountId = params.get("account_id");
  if (accountId) {
    where.push("t.account_id = ?");
    args.push(accountId);
  }
  const category = params.get("category");
  if (category) {
    where.push("t.category = ?");
    args.push(category);
  }
  const q = params.get("q");
  if (q) {
    where.push("(t.payee LIKE ? OR t.memo LIKE ?)");
    args.push(`%${q}%`, `%${q}%`);
  }

  const limitRaw = parseInt(params.get("limit") || "50", 10);
  const limit = Math.min(500, Math.max(1, isNaN(limitRaw) ? 50 : limitRaw));

  const rows = getDb()
    .prepare(
      "SELECT t.ynab_id AS id, t.date, t.amount, t.payee, t.category, t.memo, t.account_id, " +
        "a.name AS account_name FROM transactions t LEFT JOIN ynab_accounts a ON a.id = t.account_id " +
        (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
        "GROUP BY t.ynab_id ORDER BY t.date DESC, t.id DESC LIMIT ?"
    )
    .all(...args, limit) as TxRow[];

  return { transactions: rows, count: rows.length, limit };
});
