import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getYnabToken, getYnabBudgetId, setHouseholdSetting, secretsEqual, getBudgetMode } from "@/lib/household";
import { eventBus } from "@/lib/event-bus";
import { localDateIso } from "@/lib/date-utils";
import { cashFlowForMonth, localMonthCategories } from "@/lib/budget-math";

export async function GET() {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });

    const { getDb } = await import("@/lib/db");
    const { getHouseholdSetting } = await import("@/lib/household");
    const db = getDb();

    // Read from relational tables
    const accounts = db.prepare("SELECT id, name, type, balance, cleared_balance as clearedBalance FROM ynab_accounts WHERE closed = 0").all() as { id: string; name: string; type: string; balance: number; clearedBalance: number }[];

    if (accounts.length === 0) {
      // Fall back to legacy JSON cache if relational tables empty (first run)
      const cached = db.prepare("SELECT data, synced_at FROM ynab_cache WHERE id = 1").get() as { data: string; synced_at: string } | undefined;
      if (!cached) {
        console.debug("[api/ynab/sync] No cached data");
        return NextResponse.json({ success: false, error: "No cached data. Sync first." });
      }
      console.debug("[api/ynab/sync] Serving legacy cache from", cached.synced_at);
      return NextResponse.json({ success: true, data: JSON.parse(cached.data), cached: true });
    }

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const sinceDate = `${currentMonth}-01`;

    // Same-day tie-break on MAX(rowid) DESC (insertion order) so a just-added transaction shows at
    // the top of Today; the output alias `id` is ynab_id (random local_<uuid> for new rows).
    const transactions = db.prepare(
      "SELECT ynab_id as id, date, amount, payee, category, memo, approved, cleared, account_id, COALESCE(split_group, '') AS split_group FROM transactions WHERE date >= ? GROUP BY ynab_id ORDER BY date DESC, MAX(rowid) DESC"
    ).all(sinceDate) as { id: string; date: string; amount: number; payee: string; category: string; memo: string | null; approved: number; cleared: string; account_id: string; split_group: string }[];

    const monthBudgetRow = db.prepare("SELECT income, budgeted, activity, to_be_budgeted as toBeBudgeted FROM ynab_month_budget WHERE month = ?").get(currentMonth) as { income: number; budgeted: number; activity: number; toBeBudgeted: number } | undefined;

    // Local mode: the frozen ynab_categories rows are never updated after the cutover (and are empty
    // for months added since), so build the category list from the local categories table + ledger.
    const categories = getBudgetMode() === "local"
      ? localMonthCategories(db, currentMonth)
      : db.prepare("SELECT name, group_name as 'group', budgeted, activity, balance FROM ynab_categories WHERE month = ?").all(currentMonth) as { name: string; group: string; budgeted: number; activity: number; balance: number }[];

    const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
    const syncedAt = getHouseholdSetting("last_ynab_sync") || now.toISOString();

    // In local mode the frozen ynab_month_budget row is stale (YNAB no longer syncs), so the current
    // month's income and activity come from the live transactions ledger instead. Activity keeps the
    // YNAB negative convention; the dashboard takes its absolute value for "expenses".
    const cash = getBudgetMode() === "local" ? cashFlowForMonth(db, currentMonth) : null;
    const monthIncome = cash ? cash.income : (monthBudgetRow?.income || 0);
    const monthActivity = cash ? -cash.expenses : (monthBudgetRow?.activity || 0);

    const data = {
      summary: { totalBalance, accounts, categories },
      transactions: transactions.map((t) => ({ ...t, approved: !!t.approved })),
      monthBudget: {
        income: monthIncome,
        budgeted: monthBudgetRow?.budgeted || 0,
        activity: monthActivity,
        toBeBudgeted: monthBudgetRow?.toBeBudgeted || 0,
        categories,
      },
      syncedAt,
    };

    console.debug("[api/ynab/sync] Serving from SQLite:", accounts.length, "accounts,", transactions.length, "transactions,", categories.length, "categories");
    return NextResponse.json({ success: true, data, cached: true });
  } catch (error) {
    console.error("[api/ynab/sync] Cache GET error:", error);
    return NextResponse.json({ success: false, error: "Failed to read cache" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { getHouseholdSetting } = await import("@/lib/household");
    // Allow cron calls with X-Cron-Secret header matching household setting
    const cronSecret = request.headers.get("x-cron-secret");
    const expectedSecret = getHouseholdSetting("cron_secret");
    const isCron = secretsEqual(cronSecret, expectedSecret);

    let user = await getSession();
    if (!user && isCron) {
      const { getDb } = await import("@/lib/db");
      const firstUser = getDb().prepare("SELECT id FROM users ORDER BY id LIMIT 1").get() as { id: number } | undefined;
      if (firstUser) user = { id: firstUser.id } as Awaited<ReturnType<typeof getSession>>;
    }
    if (!user) {
      console.warn("[api/ynab/sync] Unauthorized sync attempt");
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    // Cron runs hourly; only perform the full sync at the configured hour (default 6),
    // and at most once per day. Manual (session) syncs are never gated.
    if (isCron) {
      const syncHour = parseInt(getHouseholdSetting("ynab_sync_hour") || "6", 10);
      const nowH = new Date();
      const todayStr = `${nowH.getFullYear()}-${String(nowH.getMonth() + 1).padStart(2, "0")}-${String(nowH.getDate()).padStart(2, "0")}`;
      if (nowH.getHours() !== syncHour) {
        console.debug("[api/ynab/sync] Cron skip: hour", nowH.getHours(), "!= scheduled", syncHour);
        return NextResponse.json({ success: true, skipped: "not scheduled hour" });
      }
      if (getHouseholdSetting("last_ynab_cron_date") === todayStr) {
        console.debug("[api/ynab/sync] Cron skip: already synced today", todayStr);
        return NextResponse.json({ success: true, skipped: "already synced today" });
      }
      setHouseholdSetting("last_ynab_cron_date", todayStr);
    }

    console.info("[api/ynab/sync] Starting sync for user", user.id, isCron ? "(cron)" : "");

    const token = getYnabToken();
    const budgetId = getYnabBudgetId();

    if (!token) {
      console.warn("[api/ynab/sync] No YNAB token for user", user.id);
      return NextResponse.json({ success: false, error: "YNAB token not configured" }, { status: 400 });
    }

    if (!budgetId) {
      console.warn("[api/ynab/sync] No YNAB budget ID for user", user.id);
      return NextResponse.json({ success: false, error: "YNAB budget ID not configured. Add it in settings." }, { status: 400 });
    }

    // Import dynamically to avoid issues when ynab isn't configured
    const { getBudgetSummary, getTransactions, getMonthBudget, getBudgetMonths } = await import("@/lib/ynab/client");
    const { getDb: getCoverageDb } = await import("@/lib/db");

    const now = new Date();
    const sinceDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    // Full-history import: on the first sync pull every month YNAB has so years of budget
    // progress can be compared, then fall back to a recent window since older months never
    // change. Coverage is judged by the earliest non-Synci/non-split transaction already local.
    const months = await getBudgetMonths(budgetId, token);
    const firstMonth = months.length ? months[0].month : sinceDate;
    const earliestLocal = (getCoverageDb()
      .prepare("SELECT MIN(date) AS d FROM transactions WHERE ynab_id NOT LIKE 'synci_%' AND ynab_id NOT LIKE 'split_%'")
      .get() as { d: string | null }).d;
    const tenBack = new Date(now.getFullYear(), now.getMonth() - 9, 1);
    const incrementalSince = `${tenBack.getFullYear()}-${String(tenBack.getMonth() + 1).padStart(2, "0")}-01`;
    const needFullHistory = !earliestLocal || earliestLocal.slice(0, 7) > firstMonth.slice(0, 7);
    const historySince = needFullHistory ? firstMonth : incrementalSince;

    console.info("[api/ynab/sync] Fetching YNAB data since", sinceDate, needFullHistory ? `(full history from ${firstMonth})` : `(incremental from ${incrementalSince})`);

    const [summary, transactions, monthBudget, heatmapTransactions] = await Promise.all([
      getBudgetSummary(budgetId, token),
      getTransactions(budgetId, sinceDate, token),
      getMonthBudget(budgetId, undefined, token),
      getTransactions(budgetId, historySince, token),
    ]);

    // Update last sync time in household settings
    setHouseholdSetting("last_ynab_sync", new Date().toISOString());

    // Auto-take net worth snapshot
    try {
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const checking = summary.accounts.filter((a: any) => a.type === "checking").reduce((s: number, a: any) => s + a.balance, 0);
      const savings = summary.accounts.filter((a: any) => a.type === "savings").reduce((s: number, a: any) => s + a.balance, 0);
      const investments = summary.accounts.filter((a: any) => a.type === "otherAsset").reduce((s: number, a: any) => s + a.balance, 0);
      const debtTotal = summary.accounts.filter((a: any) => a.type === "otherDebt").reduce((s: number, a: any) => s + a.balance, 0);
      const netWorth = checking + savings + investments + debtTotal;
      const today = localDateIso();

      db.prepare(`
        INSERT INTO net_worth_snapshots (user_id, date, checking, savings, investments, debts, net_worth)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET checking=excluded.checking, savings=excluded.savings, investments=excluded.investments, debts=excluded.debts, net_worth=excluded.net_worth
      `).run(user.id, today, checking, savings, investments, debtTotal, netWorth);
      console.info("[api/ynab/sync] Net worth snapshot auto-saved");
    } catch (err) {
      console.error("[api/ynab/sync] Failed to save net worth snapshot:", err);
    }

    // Save monthly snapshot for current month
    try {
      const { getDb: getSnapDb } = await import("@/lib/db");
      const snapDb = getSnapDb();
      const { getHouseholdSetting: getSnapSetting } = await import("@/lib/household");
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const snapMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      // Use YNAB's own income/activity figures for accuracy
      const snapIncome = monthBudget.income;
      const snapExpenses = Math.abs(monthBudget.activity);
      const snapCategories = monthBudget.categories
        .filter((c: any) => c.activity < 0 && c.name !== "Inflow: Ready to Assign")
        .sort((a: any, b: any) => a.activity - b.activity)
        .slice(0, 10)
        .map((c: any) => ({ name: c.name, amount: Math.abs(c.activity) }));
      const snapSavingGoal = parseFloat(getSnapSetting("saving_rate") || "0");

      snapDb.prepare(`
        INSERT INTO monthly_snapshots (month, income, expenses, categories_json, saving_goal)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(month) DO UPDATE SET income = excluded.income, expenses = excluded.expenses, categories_json = excluded.categories_json, saving_goal = excluded.saving_goal, updated_at = datetime('now')
      `).run(snapMonth, snapIncome, snapExpenses, JSON.stringify(snapCategories), snapSavingGoal);
      console.info("[api/ynab/sync] Monthly snapshot saved for", snapMonth);

      // Backfill every prior month YNAB has (deep history) so budget progress can be compared
      // over years: month totals + age of money, per-category detail, and the dashboard snapshot.
      // A month is skipped only once fully imported (snapshot + age of money + category rows),
      // so the first sync fills everything and later syncs stay cheap.
      const upsertPastMonthBudget = snapDb.prepare(`
        INSERT INTO ynab_month_budget (month, income, budgeted, activity, to_be_budgeted, age_of_money, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(month) DO UPDATE SET income=excluded.income, budgeted=excluded.budgeted, activity=excluded.activity, to_be_budgeted=excluded.to_be_budgeted, age_of_money=excluded.age_of_money, updated_at=datetime('now')
      `);
      const upsertPastCat = snapDb.prepare(`
        INSERT INTO ynab_categories (ynab_id, month, name, group_name, budgeted, activity, balance, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(month, name) DO UPDATE SET ynab_id=excluded.ynab_id, group_name=excluded.group_name, budgeted=excluded.budgeted, activity=excluded.activity, balance=excluded.balance, updated_at=datetime('now')
      `);
      const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      let backfilled = 0;
      for (const mo of months) {
        const pastMonth = mo.month.slice(0, 7); // YYYY-MM
        if (pastMonth >= currentMonthStr) continue; // current/future handled in the main persist block
        const snapExists = snapDb.prepare("SELECT id FROM monthly_snapshots WHERE month = ?").get(pastMonth);
        const aomRow = snapDb.prepare("SELECT age_of_money FROM ynab_month_budget WHERE month = ?").get(pastMonth) as { age_of_money: number | null } | undefined;
        const haveAom = !!aomRow && aomRow.age_of_money != null;
        const catCount = (snapDb.prepare("SELECT COUNT(*) AS n FROM ynab_categories WHERE month = ?").get(pastMonth) as { n: number }).n;
        if (snapExists && haveAom && catCount > 0) continue;

        console.info("[api/ynab/sync] Backfilling month data for", pastMonth);
        try {
          const pastSinceDate = `${pastMonth}-01`;
          const pastBudget = await getMonthBudget(budgetId, pastSinceDate, token);
          upsertPastMonthBudget.run(pastMonth, pastBudget.income, pastBudget.budgeted, pastBudget.activity, pastBudget.toBeBudgeted, pastBudget.ageOfMoney ?? null);
          const pastCatTx = snapDb.transaction(() => {
            for (const c of pastBudget.categories) {
              upsertPastCat.run(c.id || "", pastMonth, c.name, c.group || "", c.budgeted, c.activity, c.balance);
            }
          });
          pastCatTx();
          if (!snapExists) {
            const pastCategories = pastBudget.categories
              .filter((c: any) => c.activity < 0 && c.name !== "Inflow: Ready to Assign")
              .sort((a: any, b: any) => a.activity - b.activity)
              .slice(0, 10)
              .map((c: any) => ({ name: c.name, amount: Math.abs(c.activity) }));
            snapDb.prepare(`
              INSERT INTO monthly_snapshots (month, income, expenses, categories_json, saving_goal)
              VALUES (?, ?, ?, ?, 0)
            `).run(pastMonth, pastBudget.income, Math.abs(pastBudget.activity), JSON.stringify(pastCategories));
          }
          backfilled++;
          console.info("[api/ynab/sync] Backfilled", pastMonth, "categories:", pastBudget.categories.length, "age of money:", pastBudget.ageOfMoney);
        } catch (backfillErr) {
          console.warn("[api/ynab/sync] Failed to backfill", pastMonth, backfillErr);
        }
      }
      if (backfilled > 0) console.info("[api/ynab/sync] Deep backfill complete:", backfilled, "months");
    } catch (err) {
      console.error("[api/ynab/sync] Monthly snapshot error:", err);
    }

    // Auto-match transactions to income sources and bills
    try {
      const { runAutoMatch } = await import("@/lib/matching");
      const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      const matchResult = runAutoMatch(transactions, month);
      console.info("[api/ynab/sync] Auto-match:", matchResult.matched, "new matches");
    } catch (err) {
      console.error("[api/ynab/sync] Auto-match error:", err);
    }

    const syncedAt = new Date().toISOString();
    const responseData = { summary, transactions, monthBudget, syncedAt };

    // Persist to relational tables for offline-first access
    try {
      const { getDb: getPersistDb } = await import("@/lib/db");
      const pdb = getPersistDb();

      // Upsert every account (incl. closed) with YNAB's real on_budget flag, so a transfer's
      // counterparty can be classified as on- or off-budget when computing category activity.
      const upsertAccount = pdb.prepare(`
        INSERT INTO ynab_accounts (id, name, type, balance, cleared_balance, on_budget, closed, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, balance=excluded.balance, cleared_balance=excluded.cleared_balance, on_budget=excluded.on_budget, closed=excluded.closed, updated_at=datetime('now')
      `);
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const allAccts: any[] = (summary as any).allAccounts ?? summary.accounts.map((a: any) => ({ ...a, onBudget: 1, closed: 0 }));
      const accountTx = pdb.transaction(() => {
        for (const a of allAccts) {
          upsertAccount.run(a.id, a.name, a.type, a.balance, a.clearedBalance, a.onBudget ?? 1, a.closed ?? 0);
        }
      });
      accountTx();
      const closedCount = allAccts.filter((a) => a.closed).length;
      console.info("[api/ynab/sync] Persisted", allAccts.length, "accounts (", closedCount, "closed )");

      // Upsert transactions. Locally-split parents (split_group set) are left untouched so a
      // Dough-side split is not reset to YNAB's single category on the next sync.
      const upsertTx = pdb.prepare(`
        INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ynab_id) DO UPDATE SET date=excluded.date, amount=excluded.amount, payee=excluded.payee, category=excluded.category, memo=excluded.memo, account_id=excluded.account_id, approved=excluded.approved, cleared=excluded.cleared
        WHERE COALESCE(transactions.split_group, '') = ''
      `);
      const txBatch = pdb.transaction(() => {
        for (const t of heatmapTransactions) {
          upsertTx.run(user.id, t.id, t.date, t.amount, t.payee, t.category || "", t.memo || "", t.account_id || "", t.approved ? 1 : 0, t.cleared || "cleared");
        }
      });
      txBatch();

      // Delete local transactions that were removed from YNAB (all users, current month)
      const ynabIds = new Set(heatmapTransactions.map((t: any) => t.id));
      const localTx = pdb.prepare(
        "SELECT DISTINCT ynab_id FROM transactions WHERE date >= ? AND ynab_id NOT LIKE 'synci_%' AND ynab_id NOT LIKE 'split_%'"
      ).all(sinceDate) as { ynab_id: string }[];
      let deleted = 0;
      for (const lt of localTx) {
        if (!ynabIds.has(lt.ynab_id)) {
          pdb.prepare("DELETE FROM transactions WHERE ynab_id = ?").run(lt.ynab_id);
          deleted++;
        }
      }
      if (deleted > 0) console.info("[api/ynab/sync] Deleted", deleted, "removed transactions");
      console.info("[api/ynab/sync] Persisted", heatmapTransactions.length, "transactions since", historySince);

      // Upsert month budget + categories
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      pdb.prepare(`
        INSERT INTO ynab_month_budget (month, income, budgeted, activity, to_be_budgeted, age_of_money, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(month) DO UPDATE SET income=excluded.income, budgeted=excluded.budgeted, activity=excluded.activity, to_be_budgeted=excluded.to_be_budgeted, age_of_money=excluded.age_of_money, updated_at=datetime('now')
      `).run(currentMonth, monthBudget.income, monthBudget.budgeted, monthBudget.activity, monthBudget.toBeBudgeted, monthBudget.ageOfMoney ?? null);

      const upsertCat = pdb.prepare(`
        INSERT INTO ynab_categories (ynab_id, month, name, group_name, budgeted, activity, balance, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(month, name) DO UPDATE SET ynab_id=excluded.ynab_id, group_name=excluded.group_name, budgeted=excluded.budgeted, activity=excluded.activity, balance=excluded.balance, updated_at=datetime('now')
      `);
      const catBatch = pdb.transaction(() => {
        for (const c of monthBudget.categories) {
          upsertCat.run(c.id || "", currentMonth, c.name, c.group || "", c.budgeted, c.activity, c.balance);
        }
      });
      catBatch();
      console.info("[api/ynab/sync] Persisted month budget and", monthBudget.categories.length, "categories for", currentMonth);

      // Propagate YNAB category groups and assigned amounts onto the local budget tables
      const { backfillCategoryGroups, seedMonthlyBudgetsFromYnab, seedOpeningBalancesFromYnab } = await import("@/lib/db");
      backfillCategoryGroups(pdb);
      seedMonthlyBudgetsFromYnab(pdb, true);
      seedOpeningBalancesFromYnab(pdb);

      console.info("[api/ynab/sync] All relational data persisted to SQLite");
    } catch (err) {
      console.error("[api/ynab/sync] Failed to persist relational data:", err);
    }

    // Always write legacy cache as fallback
    try {
      const { getDb: getFallbackDb } = await import("@/lib/db");
      getFallbackDb().prepare(`
        INSERT INTO ynab_cache (id, data, synced_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, synced_at = excluded.synced_at
      `).run(JSON.stringify(responseData), syncedAt);
      console.debug("[api/ynab/sync] Legacy cache updated");
    } catch (err) {
      console.error("[api/ynab/sync] Legacy cache write failed:", err);
    }

    console.info("[api/ynab/sync] Sync complete. Accounts:", summary.accounts.length, "Transactions:", transactions.length);

    eventBus.emit("sync:complete", { syncedAt });
    eventBus.emit("data:updated", { source: "ynab-sync" });

    return NextResponse.json({ success: true, data: responseData });
  } catch (error) {
    console.error("[api/ynab/sync] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to sync with YNAB";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
