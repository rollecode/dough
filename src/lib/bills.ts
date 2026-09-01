// Shared recurring-bill cadence logic. A bill recurs every `interval_months` months on its due_day:
// 1 = monthly, 3 = quarterly, 12 = yearly. A bill with interval > 1 only reserves budget in its due
// month, and its category sets aside amount / interval each month so the full amount is saved by the
// time it is due. due_month (1-12) is the anchor month-of-year for any interval > 1.
//
// These helpers are imported by client components, so this module stays free of any DB access.

export interface BillCadenceFields {
  cadence?: string | null;
  due_month?: number | null;
  interval_months?: number | null;
}

// Months between occurrences. Falls back to the old cadence flag for rows written before
// interval_months existed (yearly -> 12, everything else -> 1).
export function billInterval(bill: BillCadenceFields): number {
  const n = bill.interval_months;
  if (typeof n === "number" && n >= 1) return Math.floor(n);
  return (bill.cadence || "monthly") === "yearly" ? 12 : 1;
}

export function isMonthlyBill(bill: BillCadenceFields): boolean {
  return billInterval(bill) === 1;
}

// True when the bill recurs less often than monthly, so it is not a monthly cost and only surfaces
// near its due month. Kept named isYearly for the callers that predate quarterly cadence.
export function isYearly(bill: BillCadenceFields): boolean {
  return billInterval(bill) > 1;
}

// True when the bill is due in the given calendar month (YYYY-MM). Monthly bills are due every month;
// a bill with interval N is due when the month sits on its N-month cycle anchored on due_month. The
// absolute-month arithmetic stays correct across year boundaries for any interval.
export function billDueInYearMonth(bill: BillCadenceFields, ym: string): boolean {
  const n = billInterval(bill);
  if (n === 1) return true;
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return false;
  const abs = y * 12 + (m - 1);
  const anchor = (bill.due_month || 1) - 1;
  return (((abs - anchor) % n) + n) % n === 0;
}

// Month-of-year gate for callers that only carry the month number (1-12). Exact for intervals that
// divide 12 (2, 3, 4, 6, 12); prefer billDueInYearMonth wherever the year is known.
export function billDueInMonth(bill: BillCadenceFields, month1to12: number): boolean {
  const n = billInterval(bill);
  if (n === 1) return true;
  const anchor = bill.due_month || 1;
  return (((month1to12 - anchor) % n) + n) % n === 0;
}

// Per-month amount to set aside so a bill of this amount is fully saved by its due month: amount /
// interval, to the cent. For a monthly bill this is just the amount.
export function billMonthlySetAside(amount: number, bill: BillCadenceFields): number {
  return Math.round((amount / billInterval(bill)) * 100) / 100;
}

// Human label for the next occurrence, for the bills list. Monthly bills return null (the plain
// due_day is shown). Others return d.m from due_month/due_day.
export function yearlyDueLabel(bill: BillCadenceFields & { due_day: number }): string | null {
  if (isMonthlyBill(bill) || !bill.due_month) return null;
  return `${bill.due_day}.${bill.due_month}.`;
}

// Short cadence label for the bills list, e.g. "Monthly", "Every 3 months", "Yearly".
export function cadenceLabel(bill: BillCadenceFields, locale: "fi" | "en" = "en"): string {
  const n = billInterval(bill);
  if (n === 1) return locale === "fi" ? "Kuukausittain" : "Monthly";
  if (n === 12) return locale === "fi" ? "Vuosittain" : "Yearly";
  return locale === "fi" ? `${n} kk välein` : `Every ${n} months`;
}
