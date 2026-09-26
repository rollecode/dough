/**
 * Builds a throwaway database full of invented data, for screenshots and for trying the app without
 * touching real finances. Nothing here comes from anyone's account: every payee, category, balance
 * and date is generated below.
 *
 *   npx tsx scripts/seed-demo.ts                  -> data/dough-demo.db
 *   npx tsx scripts/seed-demo.ts --out other.db   -> somewhere else
 *   npx tsx scripts/seed-demo.ts --lang en        -> English names, for the App Store
 *
 * Run the app against it with DOUGH_DB_PATH=data/dough-demo.db npm run dev
 */
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";

const REAL_DB = path.join(process.cwd(), "data", "dough.db");

const outArg = process.argv.indexOf("--out");
const OUT = path.resolve(outArg > -1 ? process.argv[outArg + 1] : path.join("data", "dough-demo.db"));

if (OUT === REAL_DB) {
  console.error("Refusing to seed over data/dough.db. Pass --out with a different file.");
  process.exit(1);
}

for (const suffix of ["", "-wal", "-shm"]) {
  if (fs.existsSync(OUT + suffix)) fs.unlinkSync(OUT + suffix);
}

process.env.DOUGH_DB_PATH = OUT;

const langArg = process.argv.indexOf("--lang");
const LANG = langArg > -1 ? process.argv[langArg + 1] : "fi";

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo1234";

const MONTHS_OF_HISTORY = 12;

// Fixed seed so two runs produce the same database and screenshots stay comparable.
let seed = 20260919;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
const round2 = (n: number) => Math.round(n * 100) / 100;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const ACCOUNTS = [
  { id: "acc-checking", name: "Käyttötili", type: "checking", balance: 3100.4, on_budget: 1 },
  { id: "acc-savings", name: "Säästötili", type: "savings", balance: 7415.0, on_budget: 1 },
  { id: "acc-card", name: "Luottokortti", type: "creditCard", balance: -641.9, on_budget: 1 },
  { id: "acc-buffer", name: "Puskuritili", type: "savings", balance: 1850.0, on_budget: 1 },
  { id: "acc-invest", name: "Indeksirahasto", type: "otherAsset", balance: 8450.0, on_budget: 0 },
  { id: "acc-fund", name: "Korkorahasto", type: "otherAsset", balance: 2890.0, on_budget: 0 },
  { id: "acc-loan", name: "Opintolaina", type: "otherDebt", balance: -4200.0, on_budget: 0 },
];

const EN: Record<string, string> = {
  Käyttötili: "Checking", Säästötili: "Savings", Luottokortti: "Credit Card", Puskuritili: "Emergency Fund",
  Indeksirahasto: "Index Fund", Korkorahasto: "Bond Fund", Opintolaina: "Student Loan",
  Ruokakauppa: "Groceries", "Ravintolat ja kahvilat": "Dining Out", Liikenne: "Transportation",
  "Koti ja tarvikkeet": "Home & Supplies", Terveys: "Health", "Vapaa-aika": "Fun", Vaatteet: "Clothing",
  Lemmikit: "Pets", Lahjat: "Gifts", "Muut kulut": "Miscellaneous", Asuminen: "Housing",
  Vakuutukset: "Insurance", Tietoliikenne: "Phone & Internet", Tilaukset: "Subscriptions",
  Kiinteät: "Fixed Costs", Arki: "Everyday", Vapaa: "Fun Money",
  Lähikauppa: "Corner Market", Marketti: "Supermarket", Torikauppa: "Farmers Market", Leipomo: "Bakery",
  Kahvila: "Coffee Shop", Lounasravintola: "Lunch Spot", Pizzeria: "Pizza Place",
  Huoltoasema: "Gas Station", Matkakortti: "Transit Pass", Pysäköinti: "Parking",
  Rautakauppa: "Hardware Store", Sisustusliike: "Home Goods", Verkkokauppa: "Online Store",
  Apteekki: "Pharmacy", Hammaslääkäri: "Dentist", Työterveys: "Urgent Care",
  Elokuvateatteri: "Movie Theater", Kirjakauppa: "Bookstore", Kuntosali: "Gym", Uimahalli: "Pool",
  Vaateliike: "Clothing Store", Kenkäkauppa: "Shoe Store", Kirpputori: "Thrift Store",
  Lemmikkikauppa: "Pet Store", Eläinlääkäri: "Vet", Kukkakauppa: "Florist", Lahjatavaraliike: "Gift Shop",
  Kioski: "Convenience Store", "Postin palvelupiste": "Post Office", Pesula: "Dry Cleaner",
  Vuokra: "Rent", Sähkö: "Electric", Vesi: "Water", Kotivakuutus: "Renters Insurance",
  Puhelinliittymä: "Phone Plan", Laajakaista: "Internet", Autovakuutus: "Car Insurance", Jätehuolto: "Trash Pickup",
  Suoratoistopalvelu: "Streaming Service", Musiikkipalvelu: "Music Service", Pilvitallennus: "Cloud Storage",
  Sanomalehti: "Newspaper", Kuntosalijäsenyys: "Gym Membership", Verkkolehti: "Online Magazine",
  Salasanaholvi: "Password Manager", Varmuuskopiointi: "Backup Service",
  Palkka: "Paycheck", Sivutoimi: "Side Gig", Puskuri: "Emergency Fund", Kesäloma: "Summer Vacation",
  "Uusi tietokone": "New Laptop", "Kolmen kuukauden menot": "Three months of expenses", "Matka kahdelle": "Trip for two",
};

// Tables stay Finnish as internal keys; names are translated where they are written.
const t = (name: string) => (LANG === "en" ? EN[name] ?? name : name);

// Category, its share of everyday spending, and the payees that post to it.
const SPEND = [
  { cat: "Ruokakauppa", weight: 30, lo: 4, hi: 38, payees: ["Lähikauppa", "Marketti", "Torikauppa", "Leipomo"] },
  { cat: "Ravintolat ja kahvilat", weight: 12, lo: 3, hi: 19, payees: ["Kahvila", "Lounasravintola", "Pizzeria"] },
  { cat: "Liikenne", weight: 10, lo: 2, hi: 24, payees: ["Huoltoasema", "Matkakortti", "Pysäköinti"] },
  { cat: "Koti ja tarvikkeet", weight: 8, lo: 4, hi: 42, payees: ["Rautakauppa", "Sisustusliike", "Verkkokauppa"] },
  { cat: "Terveys", weight: 6, lo: 5, hi: 34, payees: ["Apteekki", "Hammaslääkäri", "Työterveys"] },
  { cat: "Vapaa-aika", weight: 9, lo: 4, hi: 29, payees: ["Elokuvateatteri", "Kirjakauppa", "Kuntosali", "Uimahalli"] },
  { cat: "Vaatteet", weight: 5, lo: 8, hi: 46, payees: ["Vaateliike", "Kenkäkauppa", "Kirpputori"] },
  { cat: "Lemmikit", weight: 4, lo: 5, hi: 26, payees: ["Lemmikkikauppa", "Eläinlääkäri"] },
  { cat: "Lahjat", weight: 3, lo: 6, hi: 31, payees: ["Kukkakauppa", "Lahjatavaraliike"] },
  { cat: "Muut kulut", weight: 5, lo: 3, hi: 21, payees: ["Kioski", "Postin palvelupiste", "Pesula"] },
];
const BILLS = [
  { name: "Vuokra", amount: 985, due_day: 5, category: "Asuminen", priority: 1 },
  { name: "Sähkö", amount: 74.5, due_day: 12, category: "Asuminen", priority: 1 },
  { name: "Vesi", amount: 38, due_day: 12, category: "Asuminen", priority: 0 },
  { name: "Kotivakuutus", amount: 27.9, due_day: 18, category: "Vakuutukset", priority: 0 },
  { name: "Puhelinliittymä", amount: 24.9, due_day: 20, category: "Tietoliikenne", priority: 0 },
  { name: "Laajakaista", amount: 39.9, due_day: 20, category: "Tietoliikenne", priority: 0 },
  { name: "Autovakuutus", amount: 61.0, due_day: 22, category: "Vakuutukset", priority: 0 },
  { name: "Jätehuolto", amount: 18.5, due_day: 26, category: "Asuminen", priority: 0 },
];

const SUBSCRIPTIONS = [
  { name: "Suoratoistopalvelu", amount: 15.99, due_day: 3, color: "#239f9f" },
  { name: "Musiikkipalvelu", amount: 11.99, due_day: 7, color: "#136491" },
  { name: "Pilvitallennus", amount: 2.99, due_day: 9, color: "#6381f7" },
  { name: "Sanomalehti", amount: 24.9, due_day: 14, color: "#771bcc" },
  { name: "Kuntosalijäsenyys", amount: 39.9, due_day: 16, color: "#b31a83" },
  { name: "Verkkolehti", amount: 9.9, due_day: 21, color: "#6b6a7c" },
  { name: "Salasanaholvi", amount: 3.5, due_day: 24, color: "#239f9f" },
  { name: "Varmuuskopiointi", amount: 6.5, due_day: 27, color: "#136491" },
];

const INCOMES = [
  { name: "Palkka", amount: 2450, expected_day: 15 },
  { name: "Sivutoimi", amount: 385, expected_day: 28 },
];

const BUDGET_GROUPS: Record<string, string> = {
  Asuminen: "Kiinteät",
  Vakuutukset: "Kiinteät",
  Tietoliikenne: "Kiinteät",
  Ruokakauppa: "Arki",
  "Ravintolat ja kahvilat": "Arki",
  Liikenne: "Arki",
  "Koti ja tarvikkeet": "Arki",
  Terveys: "Arki",
  "Vapaa-aika": "Vapaa",
  Vaatteet: "Vapaa",
  Lemmikit: "Vapaa",
  Lahjat: "Vapaa",
  "Muut kulut": "Vapaa",
  Tilaukset: "Kiinteät",
};

// The dashboard's main chart colours the line by cumulative spending against the target pace, so a
// flat spend rate paints one colour for the whole month. These factors bend the rate: the current
// month starts frugal, runs level through the middle and overshoots at the end, which is what makes
// the line travel green to amber to red. Past months take turns finishing under, level and over so
// the history charts are not uniform either.
const MONTH_OUTCOME = [0.86, 1.14, 0.97, 1.2, 0.83, 1.02, 1.18, 0.88, 1.05, 0.92, 1.12, 0.95];

function paceFactor(date: Date, today: Date): number {
  const isCurrentMonth =
    date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();

  if (!isCurrentMonth) {
    const monthsBack =
      (today.getFullYear() - date.getFullYear()) * 12 + (today.getMonth() - date.getMonth());
    return MONTH_OUTCOME[monthsBack % MONTH_OUTCOME.length];
  }

  // Through the current month: well under for the first week, on the line in the middle, over by the
  // end, so today's marker sits somewhere the colour has already changed twice.
  const daysIn = date.getDate();
  if (daysIn <= 7) return 0.5;
  if (daysIn <= 14) return 0.95;
  if (daysIn <= 21) return 1.35;
  return 1.55;
}

async function main() {
  const { getDb } = await import("../src/lib/db");
  const db = getDb();

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (MONTHS_OF_HISTORY - 1), 1);

  db.exec("BEGIN");

  const userId = db
    .prepare(
      "INSERT INTO users (email, password_hash, display_name, locale) VALUES (?, ?, ?, ?)"
    )
    .run(DEMO_EMAIL, bcrypt.hashSync(DEMO_PASSWORD, 10), "Demo", LANG).lastInsertRowid as number;

  const settings: [string, string][] = [
    ["household_size", "2"],
    ["budget_threshold_tight", "20"],
    ["budget_threshold_normal", "30"],
    ["budget_threshold_good", "50"],
    ["budget_include_bills", "auto"],
    // Savings and the buffer are not day to day money, so they stay out of the daily budget. Without
    // this the whole balance is treated as spendable and the daily figure reads several hundred.
    ["budget_excluded_accounts", JSON.stringify(["acc-savings", "acc-buffer"])],
    ["last_ynab_sync", new Date(now.getTime() - 3 * 60000).toISOString()],
  ];
  const putSetting = db.prepare("INSERT OR REPLACE INTO household_settings (key, value) VALUES (?, ?)");
  for (const [k, v] of settings) putSetting.run(k, v);

  const putAccount = db.prepare(
    "INSERT INTO ynab_accounts (id, name, type, balance, cleared_balance, on_budget, closed, source, sort_order) VALUES (?, ?, ?, ?, ?, ?, 0, 'demo', ?)"
  );
  ACCOUNTS.forEach((a, i) => putAccount.run(a.id, t(a.name), a.type, a.balance, a.balance, a.on_budget, i));

  const categoryNames = [...new Set([...SPEND.map((s) => s.cat), ...BILLS.map((b) => b.category), "Tilaukset"])];
  const putCategory = db.prepare(
    "INSERT INTO categories (name, group_name, sort_order, is_active) VALUES (?, ?, ?, 1)"
  );
  const categoryIds = new Map<string, number>();
  categoryNames.forEach((name, i) => {
    const id = putCategory.run(t(name), t(BUDGET_GROUPS[name] ?? "Arki"), i).lastInsertRowid as number;
    categoryIds.set(name, id);
  });

  const putIncome = db.prepare(
    "INSERT INTO income_sources (user_id, name, amount, expected_day, is_recurring, is_active, target_account_id) VALUES (?, ?, ?, ?, 1, 1, 'acc-checking')"
  );
  for (const i of INCOMES) putIncome.run(userId, t(i.name), i.amount, i.expected_day);

  const putBill = db.prepare(
    "INSERT INTO recurring_bills (user_id, name, amount, due_day, category, is_active, is_priority, cadence, interval_months) VALUES (?, ?, ?, ?, ?, 1, ?, 'monthly', 1)"
  );
  for (const b of BILLS) putBill.run(userId, t(b.name), b.amount, b.due_day, t(b.category), b.priority);

  const putSub = db.prepare(
    "INSERT INTO subscriptions (name, amount, due_day, brand_color, is_active) VALUES (?, ?, ?, ?, 1)"
  );
  for (const s of SUBSCRIPTIONS) putSub.run(t(s.name), s.amount, s.due_day, s.color);

  db.prepare(
    "INSERT INTO debts (user_id, name, total_amount, remaining_amount, interest_rate, minimum_payment, due_day) VALUES (?, ?, 9000, 4200, 1.4, 95, 10)"
  ).run(userId, t("Opintolaina"));

  // Investments are read from the otherAsset accounts, with contribution and return per account.
  const putOverride = db.prepare(
    "INSERT INTO investment_overrides (ynab_account_id, monthly_contribution, expected_return, notes) VALUES (?, ?, ?, '')"
  );
  putOverride.run("acc-invest", 250, 7);
  putOverride.run("acc-fund", 100, 3);

  const putGoal = db.prepare(
    "INSERT INTO savings_goals (name, target_amount, saved_amount, priority, target_date, is_active, description) VALUES (?, ?, ?, ?, ?, 1, ?)"
  );
  putGoal.run(t("Puskuri"), 6000, 4820, "must", `${now.getFullYear() + 1}-06-30`, t("Kolmen kuukauden menot"));
  putGoal.run(t("Kesäloma"), 1800, 940, "want", `${now.getFullYear() + 1}-05-31`, t("Matka kahdelle"));
  putGoal.run(t("Uusi tietokone"), 1500, 310, "want", `${now.getFullYear() + 1}-11-30`, "");

  // Transactions: everyday spending, bills, subscriptions and income, day by day.
  const putTx = db.prepare(
    "INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, is_recurring, account_id, approved, cleared) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 1, 'cleared')"
  );
  const totalWeight = SPEND.reduce((s, c) => s + c.weight, 0);
  const monthTotals = new Map<string, { income: number; expenses: number; byCat: Map<string, number> }>();

  const bump = (month: string, income: number, expenses: number, cat?: string, amount = 0) => {
    if (!monthTotals.has(month)) monthTotals.set(month, { income: 0, expenses: 0, byCat: new Map() });
    const m = monthTotals.get(month)!;
    m.income += income;
    m.expenses += expenses;
    if (cat) m.byCat.set(cat, (m.byCat.get(cat) ?? 0) + amount);
  };

  let txSeq = 0;
  const nextId = () => `demo-${String(++txSeq).padStart(6, "0")}`;

  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    const date = iso(d);
    const month = ym(d);
    const day = d.getDate();
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    // Everyday purchases. Weekends run a little busier, as they do, and the month's pace bends the
    // rate so the spending line crosses its target instead of sitting on one side of it.
    const pace = paceFactor(d, now);
    const purchases = Math.round(between(isWeekend ? 2 : 1, isWeekend ? 5 : 4) * pace);
    for (let i = 0; i < purchases; i++) {
      let roll = rnd() * totalWeight;
      const bucket = SPEND.find((c) => (roll -= c.weight) <= 0) ?? SPEND[0];
      const amount = -round2(between(bucket.lo, bucket.hi) * pace);
      putTx.run(userId, nextId(), date, amount, t(pick(bucket.payees)), t(bucket.cat), 0, pick(["acc-checking", "acc-card"]));
      bump(month, 0, -amount, bucket.cat, -amount);
    }

    for (const b of BILLS) {
      if (b.due_day !== day) continue;
      const amount = -round2(b.amount * between(0.97, 1.06));
      putTx.run(userId, nextId(), date, amount, t(b.name), t(b.category), 1, "acc-checking");
      bump(month, 0, -amount, b.category, -amount);
    }

    for (const s of SUBSCRIPTIONS) {
      if (s.due_day !== day) continue;
      putTx.run(userId, nextId(), date, -s.amount, t(s.name), t("Tilaukset"), 1, "acc-card");
      bump(month, 0, s.amount, "Tilaukset", s.amount);
    }

    for (const inc of INCOMES) {
      if (inc.expected_day !== day) continue;
      const amount = round2(inc.amount * between(0.98, 1.05));
      putTx.run(userId, nextId(), date, amount, t(inc.name), "Inflow: Ready to Assign", 1, "acc-checking");
      bump(month, amount, 0);
    }
  }

  // Monthly history, the daily budget streak and the net worth curve, derived from the above.
  const putSnapshot = db.prepare(
    "INSERT OR REPLACE INTO monthly_snapshots (month, income, expenses, categories_json, saving_goal) VALUES (?, ?, ?, ?, 0)"
  );
  const putBudget = db.prepare(
    "INSERT INTO monthly_category_budgets (month, category_id, budgeted) VALUES (?, ?, ?)"
  );
  for (const [month, totals] of monthTotals) {
    const categories = [...totals.byCat.entries()]
      .map(([name, amount]) => ({ name: t(name), amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount);
    putSnapshot.run(month, round2(totals.income), round2(totals.expenses), JSON.stringify(categories));

    for (const [name, spent] of totals.byCat) {
      const id = categoryIds.get(name);
      if (id) putBudget.run(month, id, Math.round((spent * between(0.95, 1.2)) / 5) * 5);
    }
  }

  const putDaily = db.prepare(
    "INSERT OR REPLACE INTO daily_budget_history (date, budget, spent, discretionary_target) VALUES (?, ?, ?, ?)"
  );
  const spentByDate = db
    .prepare(
      "SELECT date, SUM(ABS(amount)) AS spent FROM transactions WHERE amount < 0 AND is_recurring = 0 GROUP BY date"
    )
    .all() as { date: string; spent: number }[];
  for (const row of spentByDate) {
    const budget = round2(between(28, 36));
    putDaily.run(row.date, budget, round2(row.spent), round2(budget * 0.9));
  }

  const putNetWorth = db.prepare(
    "INSERT INTO net_worth_snapshots (date, checking, savings, investments, debts, net_worth) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const putProgress = db.prepare(
    "INSERT OR REPLACE INTO investment_progress (date, total_value, total_contributed) VALUES (?, ?, ?)"
  );

  const months = [...monthTotals.keys()].sort();
  months.forEach((month, i) => {
    const progress = i / Math.max(1, months.length - 1);
    const checking = round2(1850 + progress * 630 + between(-120, 120));
    const savings = round2(4900 + progress * 4365);
    const investments = round2(8200 + progress * 4640);
    const debts = round2(-(5400 - progress * 1200));
    putNetWorth.run(`${month}-01`, checking, savings, investments, debts, round2(checking + savings + investments + debts));
    putProgress.run(`${month}-01`, investments, round2(7100 + progress * 3150));
  });

  // The dashboard reads balances from the sync cache, so it has to agree with the accounts above.
  const txForCache = db
    .prepare("SELECT ynab_id AS id, date, amount, payee, category, account_id AS accountId FROM transactions ORDER BY date DESC LIMIT 400")
    .all();
  const cache = {
    summary: {
      totalBalance: round2(ACCOUNTS.filter((a) => a.on_budget).reduce((s, a) => s + a.balance, 0)),
      accounts: ACCOUNTS.map((a) => ({ id: a.id, name: t(a.name), type: a.type, balance: a.balance, clearedBalance: a.balance })),
      allAccounts: ACCOUNTS.map((a) => ({ id: a.id, name: t(a.name), type: a.type, balance: a.balance, clearedBalance: a.balance })),
      closedAccountIds: [],
      categories: categoryNames.map((name) => ({ name: t(name), budgeted: 0, activity: 0, balance: 0 })),
    },
    transactions: txForCache,
    monthBudget: { month: ym(now), toBeBudgeted: 0 },
    syncedAt: new Date(now.getTime() - 3 * 60000).toISOString(),
  };
  db.prepare("INSERT OR REPLACE INTO ynab_cache (id, data, synced_at) VALUES (1, ?, ?)").run(
    JSON.stringify(cache),
    cache.syncedAt
  );

  db.exec("COMMIT");

  const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  console.info("[seed-demo] Wrote", OUT);
  console.info("[seed-demo] transactions", count("transactions"), "over", MONTHS_OF_HISTORY, "months");
  console.info("[seed-demo] categories", count("categories"), "bills", count("recurring_bills"), "subscriptions", count("subscriptions"));
  console.info("[seed-demo] months", count("monthly_snapshots"), "daily budget days", count("daily_budget_history"));
  console.info("[seed-demo] Sign in with", DEMO_EMAIL, "/", DEMO_PASSWORD);
}

main().catch((err) => {
  console.error("[seed-demo] Failed:", err);
  process.exit(1);
});
