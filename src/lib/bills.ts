// Shared recurring-bill cadence logic. A monthly bill recurs every month on its due_day; a yearly
// bill recurs once a year on due_month/due_day. The daily-budget and summary consumers must gate
// yearly bills identically, so a yearly bill only reserves budget in (and near) its due month and
// never shows up as a monthly obligation the other eleven months.

export interface BillCadenceFields {
  cadence?: string | null;
  due_month?: number | null;
}

export function isYearly(bill: BillCadenceFields): boolean {
  return (bill.cadence || "monthly") === "yearly";
}

// True when the bill is an obligation in the given calendar month (1-12). Monthly bills are due
// every month; a yearly bill is due only in its due_month.
export function billDueInMonth(bill: BillCadenceFields, month1to12: number): boolean {
  if (!isYearly(bill)) return true;
  return (bill.due_month || 0) === month1to12;
}

// Human label for the next occurrence of a bill, for the bills list. Monthly bills return null
// (the plain due_day is shown as today). Yearly bills return d.m from due_month/due_day.
export function yearlyDueLabel(bill: BillCadenceFields & { due_day: number }): string | null {
  if (!isYearly(bill) || !bill.due_month) return null;
  return `${bill.due_day}.${bill.due_month}.`;
}
