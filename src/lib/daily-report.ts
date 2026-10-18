import { getDb } from "@/lib/db";
import { getHouseholdSetting } from "@/lib/household";
import { dashboardFor } from "@/lib/dashboard-for";
import { localDateIso } from "@/lib/date-utils";
import { NOT_BUDGET_EXCLUDED } from "@/lib/budget-math";
import { routineAnswer } from "@/lib/ai/routine";

// The end-of-day report: how one day went against its budget, written by the AI from the figures
// the dashboard itself computes. One report per day and language, kept until it is regenerated, so
// a morning's late bank transactions can be folded in with one tap.

export type ReportLocale = "en" | "fi";

export interface DailyReport {
  date: string;
  content: string;
  created_at: string;
}

// From this hour on the report is about today; before it, about yesterday.
export const DAILY_REPORT_HOUR = 18;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function dailyReportEnabled(): boolean {
  return getHouseholdSetting("daily_report_disabled") !== "1";
}

// The day a report is about when none is named: today in the evening, yesterday before it.
export function reportDay(now: Date = new Date()): string {
  if (now.getHours() >= DAILY_REPORT_HOUR) return localDateIso(now);
  return localDateIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}

export function isReportDay(value: string | null): value is string {
  return !!value && ISO_DAY.test(value) && value <= localDateIso();
}

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS daily_reports (
      date TEXT NOT NULL,
      locale TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (date, locale)
    )
  `);
}

export function storedReport(date: string, locale: ReportLocale): DailyReport | null {
  ensureTable();
  const row = getDb()
    .prepare("SELECT date, content, created_at FROM daily_reports WHERE date = ? AND locale = ?")
    .get(date, locale) as DailyReport | undefined;
  return row ?? null;
}

// The stored report, or a new one when there is none or a fresh one is asked for.
export async function dailyReport(
  userId: number,
  date: string,
  locale: ReportLocale,
  regenerate = false
): Promise<DailyReport | null> {
  console.debug("[daily-report] Asked for", date, locale, regenerate ? "(regenerate)" : "");
  const stored = storedReport(date, locale);
  if (stored && !regenerate) return stored;

  const prompt = reportPrompt(userId, date, locale);
  if (!prompt) {
    console.info("[daily-report] No figures for", date, "so no report");
    return stored;
  }

  console.info("[daily-report] Writing the report for", date, locale);
  const content = (await routineAnswer("insight", prompt, { timeoutMs: 120000, claudeModel: "sonnet" })).trim();
  if (!content) {
    console.warn("[daily-report] The AI returned nothing for", date);
    return stored;
  }

  getDb()
    .prepare(
      "INSERT INTO daily_reports (date, locale, content, created_at) VALUES (?, ?, ?, datetime('now')) " +
        "ON CONFLICT(date, locale) DO UPDATE SET content = excluded.content, created_at = excluded.created_at"
    )
    .run(date, locale, content);
  console.info("[daily-report] Stored", date, locale, "length", content.length);
  return storedReport(date, locale);
}

// The facts the report is written from. Today's come from the live dashboard; a past day's budget is
// the one the day was actually given, from the daily budget history.
function reportPrompt(userId: number, date: string, locale: ReportLocale): string | null {
  const db = getDb();
  const dashboard = dashboardFor(userId);
  const isToday = date === localDateIso();

  const history = db.prepare("SELECT budget FROM daily_budget_history WHERE date = ?").get(date) as
    | { budget: number }
    | undefined;
  const budget = isToday ? dashboard.daily_budget.amount : history?.budget ?? null;
  if (budget === null) return null;

  const spent = dashboard.streak.spent_by_date[date] ?? 0;
  const transactions = db
    .prepare(
      "SELECT t.payee, t.amount, t.category, u.display_name AS spender FROM transactions t " +
        "LEFT JOIN users u ON t.user_id = u.id WHERE t.date = ? AND t.payee NOT LIKE 'Transfer%' " +
        "AND t.payee NOT LIKE 'Starting Balance%' AND t.payee NOT LIKE 'Reconciliation%' AND " +
        NOT_BUDGET_EXCLUDED +
        " GROUP BY t.ynab_id ORDER BY t.amount ASC"
    )
    .all(date) as { payee: string; amount: number; category: string; spender: string | null }[];

  const lines = transactions
    .map((t) => `- ${t.payee}: ${t.amount} euros, ${t.category || "uncategorised"}${t.spender ? `, by ${t.spender}` : ""}`)
    .join("\n");
  const left = Math.round((budget - spent) * 100) / 100;
  const month = dashboard.month_summary;

  return `You write the end-of-day report in Dough, a household budget app. The person reads it inside Dough, so never talk about Dough as somewhere else.
Write in ${locale === "fi" ? "Finnish" : "English"}.

The day: ${date}${isToday ? " (today)" : ""}.
Figures computed by the app (use these numbers, never compute your own totals):
- Daily budget for the day: ${budget} euros
- Spent on everyday spending that day: ${spent} euros
- ${left >= 0 ? `Left of the budget: ${left} euros` : `Over the budget by ${Math.abs(left)} euros`}${isToday ? `\n- Budget for tomorrow: ${dashboard.daily_budget.tomorrow} euros` : ""}
- Savings streak: ${dashboard.streak.days} days
- This month so far: spending ${month.activity} euros, ${month.burn_rate} euros a day over the last 30 days, ${month.days_left} days left
- Projected balance at month end: ${dashboard.balances.projected_month_end} euros
Transactions that day (bills and fixed costs included; the daily budget counts only everyday spending):
${lines || "- none recorded"}

Write at most three short paragraphs: how the day went against its budget, what stood out (the biggest purchases or categories), and one practical note for tomorrow. Plain words, no headings, no em dashes or en dashes. If nothing was recorded, say so briefly and mention that the bank may not have sent every transaction yet.
Mark each euro amount that is money moving by its kind, as a Markdown link to that kind: money going out as [45,00 €](#expense), money coming in as [1 200,00 €](#income), a transfer between the household's own accounts as [200,00 €](#transfer). Other amounts stay in plain bold.`;
}

// What both routes answer: the report for the asked day and language, or why there is none.
export async function reportResponse(userId: number, day: string | null, lang: string | null, regenerate: boolean) {
  const locale: ReportLocale = lang === "fi" ? "fi" : "en";
  if (!dailyReportEnabled()) return { disabled: true, date: null, report: null, created_at: null };

  const date = day ?? reportDay();
  if (!isReportDay(date)) return { error: "date must be YYYY-MM-DD and not in the future" };

  const report = await dailyReport(userId, date, locale, regenerate);
  return { disabled: false, date, report: report?.content ?? null, created_at: report?.created_at ?? null };
}
