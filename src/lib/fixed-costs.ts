// What is not day-to-day spending: a bill or subscription, a debt payment, an investment transfer.
// The daily budget reserves those separately, so counting them again as spending would count them
// twice. Shared by the web page and lib/dashboard-model, so both clients sort a transaction alike.
//
// A payee or category matches a name when either contains the other, which is how a payee like
// "NETFLIX.COM 1234" is caught by the subscription "Netflix". An empty value is not a match: every
// name contains the empty string, which used to turn every uncategorised purchase into a bill.
export function fixedCostMatcher(billNames: string[], debtNames: string[]) {
  const bills = billNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
  const debts = debtNames.map((n) => n.trim().toLowerCase()).filter(Boolean);

  const matches = (value: string, names: string[]) =>
    value !== "" && names.some((n) => value.includes(n) || n.includes(value));

  return (payee: string, category: string): boolean => {
    const p = (payee || "").trim().toLowerCase();
    const c = (category || "").trim().toLowerCase();
    if (matches(p, bills) || matches(c, bills)) return true;
    if (matches(p, debts) || matches(c, debts)) return true;
    return c.includes("sijoittaminen") || c.includes("investing") || c.includes("investment");
  };
}
