import { getDb } from "@/lib/db";
import { getHouseholdSettings } from "@/lib/household";
import { buildLocalFinancialData } from "@/lib/local-financial-data";
import { monthCommitments } from "@/lib/commitments";
import { monthStatus, type MonthStatus } from "@/lib/dashboard-model";

// The month's income and its end-of-month cost, assembled from the database rather than from
// whatever a client happened to fetch. Both the dashboard page and /api/v1/dashboard read this, so
// a browser and a phone cannot arrive at different figures - they did for a week.
export function currentMonthStatus(now = new Date()): MonthStatus {
  const db = getDb();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const settings = getHouseholdSettings();
  const data = buildLocalFinancialData(db);

  const billRows = db
    .prepare("SELECT id, amount, is_active FROM recurring_bills")
    .all() as { id: number; amount: number; is_active: number }[];
  const subscriptionRows = db
    .prepare("SELECT id, amount, is_active FROM subscriptions")
    .all() as { id: number; amount: number; is_active: number }[];

  const manualPaid = new Map(
    (db.prepare("SELECT bill_id, is_paid FROM bill_manual_status WHERE month = ?").all(month) as {
      bill_id: number; is_paid: number;
    }[]).map((r) => [r.bill_id, !!r.is_paid])
  );
  const matchedBills = new Set(
    (db.prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'bill' AND month = ?").all(month) as {
      source_id: number;
    }[]).map((r) => r.source_id)
  );
  const matchedSubscriptions = new Set(
    (db.prepare("SELECT source_id FROM monthly_matches WHERE source_type = 'subscription' AND month = ?").all(month) as {
      source_id: number;
    }[]).map((r) => r.source_id)
  );

  // A subscription's manual status shares the bills table with its id offset by 10000.
  const SUBSCRIPTION_ID_OFFSET = 10000;
  const bills = [
    ...billRows.map((b) => ({
      amount: b.amount,
      is_active: !!b.is_active,
      is_paid: manualPaid.has(b.id) ? manualPaid.get(b.id)! : matchedBills.has(b.id),
    })),
    ...subscriptionRows.map((s) => {
      const key = s.id + SUBSCRIPTION_ID_OFFSET;
      return {
        amount: s.amount,
        is_active: !!s.is_active,
        is_paid: manualPaid.has(key) ? manualPaid.get(key)! : matchedSubscriptions.has(s.id),
      };
    }),
  ];

  const incomes = db
    .prepare("SELECT amount, is_active FROM income_sources")
    .all() as { amount: number; is_active: number }[];

  const commitments = monthCommitments(db, month);

  return monthStatus({
    now,
    transactions: data.transactions,
    monthBudgetIncome: data.monthBudget.income,
    incomes,
    bills,
    savingRate: parseFloat(settings.saving_rate || "0") || 0,
    debtMonthly: commitments.debtMonthly,
    investmentMonthly: commitments.investmentMonthly,
    commitmentCategories: commitments.categories,
  });
}
