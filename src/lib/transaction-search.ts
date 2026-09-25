// What a search box matches in the ledger: payee, category, memo and account name, and the amount
// formatted to cents when the query is a number, a Finnish decimal comma accepted. The web's own
// transactions filter, as a query, so every client searches the same way. Expects the transactions
// table as `t` and accounts joined as `a`.
export function transactionSearch(query: string): { clause: string; args: string[] } {
  const q = query.trim();
  const like = `%${q}%`;
  const parts = ["t.payee LIKE ?", "t.category LIKE ?", "COALESCE(t.memo, '') LIKE ?", "COALESCE(a.name, '') LIKE ?"];
  const args = [like, like, like, like];

  const number = q.replace(",", ".");
  if (/^\d+(\.\d+)?$/.test(number)) {
    parts.push("printf('%.2f', ABS(t.amount)) LIKE ?");
    args.push(`%${number}%`);
  }
  return { clause: `(${parts.join(" OR ")})`, args };
}
