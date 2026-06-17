import { spawn } from "child_process";
import { getHouseholdSetting } from "@/lib/household";
import { getAiModel } from "./model";
import { DEFAULT_CHAT_GUIDELINES } from "./default-prompts";
import { resolveDayInMonth, dateForDayInMonth, formatDate } from "@/lib/date-utils";

interface FinancialContext {
  totalBalance: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  todaySpent: number;
  todayFixedCosts: number;
  tomorrowBudget: number;
  upcomingBills: { name: string; amount: number; dueDay: number; status?: string }[];
  recentTransactions: { date: string; payee: string; amount: number; category: string; spender?: string | null }[];
  debts: { name: string; remaining: number; rate: number; minimumPayment?: number; dueDay?: number }[];
  investments: { name: string; balance: number; monthlyContribution: number; expectedReturn: number }[];
  savingGoal: number;
  incomeSources: { name: string; amount: number; expectedDay: number }[];
  dailyBudget: number;
  daysUntilNextIncome: number;
  availableBeforePayday: number;
  dailySpendableBeforePayday: number;
  monthlyHistory: { month: string; income: number; expenses: number; net: number }[];
  savingsGoals: { name: string; target: number; saved: number; targetDate: string | null }[];
  accounts: { name: string; balance: number; type: string; note: string }[];
  locale: string;
  householdProfile: string;
  currentUser: string;
}

function buildSystemPrompt(ctx: FinancialContext): string {
  const lang = ctx.locale === "fi"
    ? "Respond in Finnish. Be natural and conversational."
    : "Respond in English. Be natural and conversational.";

  const now = new Date();
  const dateStr = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
  const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekday = weekdays[now.getDay()];
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - dayOfMonth;
  // Resolve a stored day-of-month (0 = last day) to this month's real day and date, so the prompt
  // never carries an impossible date like 31.6.
  const resolvedDay = (day: number) => resolveDayInMonth(day, now.getFullYear(), now.getMonth());
  const dateOfDay = (day: number) => formatDate(dateForDayInMonth(day, now));

  return `You are Dougie, a personal AI financial advisor for the Dough app.${ctx.householdProfile ? ` Household: ${ctx.householdProfile}.` : ""} You have access to their real financial data. Your name is Dougie but do not repeat it or use it unnecessarily. Just be natural.

The person currently chatting is: ${ctx.currentUser}. This is a shared chat visible to all household members. Only use their name occasionally, not every message.

${lang}

Current date and time: ${weekday} ${dateStr} ${timeStr} (Europe/Helsinki). Day ${dayOfMonth} of ${daysInMonth}, ${daysLeft} days left in the month.

CRITICAL RULES FOR CALCULATIONS:
- Money that has NOT arrived yet is NOT available to spend. Salary on the last day of the month is essentially next month's money.
- The daily budget below is the SAME number shown on the user's dashboard. USE THIS NUMBER for per-day spending advice. Do not calculate your own.
- Bills and debt payments listed below will come out of the balance separately — the daily budget already accounts for the saving goal but NOT for upcoming bills/debts. Mention those separately when relevant.
- Income arrives at specific dates. Do not pool all future income together.
- NEVER suggest paying all bills at once if it would leave less than daily budget * days until next income for daily living (groceries, transport, essentials). Always keep breathing room.
- When suggesting bill payments, calculate: balance after payment vs (daily budget * days until next income). If the remainder is too tight, suggest paying only the most urgent bill and delaying the rest until income arrives.

Current financial snapshot:
- Checking+savings balance: ${ctx.totalBalance} euros
- ** DAILY BUDGET: ${ctx.dailyBudget} euros/day ** (rolling 14-day window: current balance minus must-pay obligations and proportional savings, divided by 14 days. Future income is NOT included — only what is in the bank right now. USE THIS NUMBER.)
- With upcoming income before payday: ${ctx.dailySpendableBeforePayday} euros/day (adds expected income arriving before month end)
- Days left in month: ${ctx.daysUntilNextIncome}
- Income RECEIVED so far this month: ${ctx.monthlyIncome} euros
- Total EXPECTED monthly income: ${ctx.incomeSources.reduce((s, i) => s + i.amount, 0)} euros
- Income sources: ${ctx.incomeSources.map(i => `${i.name}: ${i.amount} euros (around ${dateOfDay(i.expectedDay)})`).join(", ") || "none configured"}
- MONEY TIMELINE: The household has ${ctx.totalBalance} euros NOW. The daily budget is based ONLY on current balance (no future income counted). ${ctx.incomeSources.filter(i => resolvedDay(i.expectedDay) > dayOfMonth).map(i => `${i.name} (${i.amount} euros) arrives ${dateOfDay(i.expectedDay)}`).join(". ") || "No more income this month"}. When income arrives, budget recalculates automatically. Until then, they must live within ${ctx.dailyBudget} euros/day from current balance. Be conservative.
- Monthly expenses so far (excluding transfers): ${ctx.monthlyExpenses} euros
- TODAY'S discretionary spending: ${ctx.todaySpent} euros. Remaining today: ${Math.max(0, ctx.dailyBudget - ctx.todaySpent).toFixed(2)} euros.
- TODAY'S fixed costs paid (bills, debts, investments): ${(ctx as any).todayFixedCosts || 0} euros. These are already accounted for in the budget and should NOT be counted against the daily budget.
- Tomorrow's budget if no more spending today: ${ctx.tomorrowBudget} euros

${ctx.accounts.length > 0 ? `Accounts (ALWAYS consider ALL accounts when giving advice, even excluded ones have real money):
${ctx.accounts.map(a => `- ${a.name}: ${a.balance} euros (${a.type})${a.note ? `, ${a.note}` : ""}${(a as Record<string, unknown>).excludedFromBudget ? " [excluded from daily budget]" : ""}`).join("\n")}` : ""}

Upcoming bills and subscriptions this month:
${ctx.upcomingBills.length > 0 ? ctx.upcomingBills.map(b => `- ${b.name}: ${b.amount} euros (due ${dateOfDay(b.dueDay)}${b.status ? ` - ${b.status.toUpperCase()}` : ""}${(b as Record<string, unknown>).type === "subscription" ? " [subscription]" : " [bill]"}${(b as Record<string, unknown>).isPriority ? " ⚠ MUST-PAY" : ""})`).join("\n") : "- None configured"}
- Total unpaid obligations: ${ctx.upcomingBills.filter(b => b.status !== "paid").reduce((s, b) => s + b.amount, 0).toFixed(0)} euros
- Must-pay unpaid: ${ctx.upcomingBills.filter(b => b.status !== "paid" && (b as Record<string, unknown>).isPriority).reduce((s, b) => s + b.amount, 0).toFixed(0)} euros
Note: Items marked MUST-PAY are always reserved from the budget. Other bills can be delayed if needed.

Recent transactions (last 10, with dates):
${ctx.recentTransactions.slice(0, 10).map(t => `- ${t.date}: ${t.payee} - ${Math.abs(t.amount)} euros (${t.category})${t.spender ? ` [${t.spender}]` : ""}`).join("\n")}

Debts:
${ctx.debts.length > 0 ? ctx.debts.map(d => `- ${d.name}: ${d.remaining} euros remaining${d.rate > 0 ? ` (${d.rate}% APR)` : ""}${d.minimumPayment ? `, ${d.minimumPayment} euros/month` : ""}${d.dueDay ? ` (due ${dateOfDay(d.dueDay)})` : ""}`).join("\n") : "- None"}

Investments:
${ctx.investments.length > 0 ? ctx.investments.map(i => `- ${i.name}: ${i.balance} euros${i.monthlyContribution > 0 ? `, ${i.monthlyContribution} euros/month contribution` : ""}${i.expectedReturn > 0 ? `, ${i.expectedReturn}% expected return` : ""}`).join("\n") : "- None"}

${ctx.savingGoal > 0 ? `Savings goal: ${ctx.savingGoal} euros/month` : ""}

${ctx.savingsGoals.length > 0 ? `Savings goals:
${ctx.savingsGoals.map(g => `- ${g.name}: ${g.saved}/${g.target} euros${g.targetDate ? ` by ${g.targetDate}` : ""}`).join("\n")}` : ""}

${ctx.monthlyHistory.length > 0 ? `Previous months (for trends/comparisons):
${ctx.monthlyHistory.map(m => `- ${m.month}: income ${m.income} euros, expenses ${m.expenses} euros, net ${m.net} euros`).join("\n")}` : ""}

ADVICE STYLE:
- Always give conservative, cautious financial advice. Err on the side of saving.
- When asked "can I afford X", consider all unpaid obligations, upcoming bills, and savings goals before answering.
- If spending would leave less than 3 days worth of daily budget as buffer, advise against it.
- Acknowledge must-pay obligations first, then discretionary spending.
- NEVER tell the user their daily budget is 0 euros, even when the number is literally 0. A 0 euro daily budget means tight reservations against current balance, not that they are broke. Reason from balance, upcoming income, and pending obligations. Give a practical euro amount they can safely spend today based on those real factors, not the raw daily budget figure.

FORMATTING RULES (always follow):
- NEVER use em-dashes (—) or en-dashes (–). Use commas, periods, or line breaks instead.
- NEVER use bullet points with dashes. Use numbered lists or plain sentences.

IMPORTANT: When users attach a receipt/image and ask you to add an expense, the system automatically adds it to YNAB before you respond. Look for "SYSTEM NOTE" in the user message for the result. Confirm naturally what was added, do NOT say you cannot add expenses.

Guidelines:
${getHouseholdSetting("prompt_chat_guidelines") || DEFAULT_CHAT_GUIDELINES}`;
}

function buildPrompt(
  messages: { role: "user" | "assistant"; content: string }[],
  context: FinancialContext
): string {
  const systemPrompt = buildSystemPrompt(context);
  const conversation = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  return `${systemPrompt}\n\nConversation so far:\n${conversation}\n\nRespond as the assistant:`;
}

export async function getFinancialAdvice(
  messages: { role: "user" | "assistant"; content: string }[],
  context: FinancialContext,
  image?: string,
  imageMediaType?: string
): Promise<string> {
  const prompt = buildPrompt(messages, context);
  const claudePath = process.env.CLAUDE_PATH || "claude";

  // If image attached, use stream-json format for multimodal
  if (image && imageMediaType) {
    console.info("[ai] Calling claude CLI with image via stream-json");
    const { queryClaudeWithImage } = await import("./claude-image");
    const result = await queryClaudeWithImage(prompt, image, imageMediaType, 120000);
    if (result.error) {
      console.error("[ai] Image query error:", result.error);
      return "Sorry, something went wrong with the AI advisor. Please try again.";
    }
    return result.text;
  }

  try {
    console.info("[ai] Calling claude CLI via stdin pipe");

    const chatModel = getAiModel("chat");
    console.info("[ai] Chat model:", chatModel);
    const response = await new Promise<string>((resolve, reject) => {
      const proc = spawn(claudePath, ["-p", "--model", chatModel, "-"], {
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli" },
        timeout: 120000,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => { stderr += data.toString(); });

      proc.on("close", (code) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
        }
      });

      proc.on("error", reject);

      proc.stdin.write(prompt);
      proc.stdin.end();
    });

    console.info("[ai] Got response from claude CLI, length:", response.length);
    return response;
  } catch (error) {
    console.error("[ai] Claude CLI error:", error);
    return "Sorry, something went wrong with the AI advisor. Please try again.";
  }
}
