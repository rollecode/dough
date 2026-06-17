import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { getYnabToken, getYnabBudgetId, getHouseholdSetting, setHouseholdSetting, getBudgetMode } from "@/lib/household";
import { eventBus } from "@/lib/event-bus";
import { categorizePayee } from "@/lib/ai/categorize";
import { INTERNAL_TRANSFER_CATEGORY } from "@/lib/transaction-utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

const aiCategorize = categorizePayee;

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { account_id, amount, payee_name, memo, category_id, category, date } = body;
    // Inflow (income) is stored positive and lands in Ready to Assign; the default is an outflow
    // (expense). Keeps the expense path exactly as before when the flag is absent.
    const inflow = body.inflow === true;

    if (!account_id || !amount || !payee_name) {
      return NextResponse.json({ error: "Account, amount and payee required" }, { status: 400 });
    }

    // LOCAL MODE: write straight to Dough, no YNAB. Dormant while YNAB connected.
    if (getBudgetMode() === "local") {
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      const signed = inflow ? Math.abs(parseFloat(amount)) : parseFloat(amount) * -1; // expense negative, income positive
      const txDate = date || new Date().toISOString().slice(0, 10);
      const id = `local_${randomUUID()}`;

      // Category: an explicit name (reviewed in the modal) wins, then a category_id. Income lands
      // in Ready to Assign; an uncategorised expense falls back to an AI guess.
      let categoryName = "";
      if (typeof category === "string" && category) {
        categoryName = category;
      } else if (category_id) {
        const c = db.prepare("SELECT name FROM categories WHERE id = ?").get(category_id) as { name: string } | undefined;
        categoryName = c?.name || "";
      } else if (inflow) {
        categoryName = "Inflow: Ready to Assign";
      } else {
        try {
          const names = (db.prepare("SELECT name FROM categories WHERE is_active = 1").all() as { name: string }[]).map((c) => c.name);
          if (names.length > 0) categoryName = (await aiCategorize(payee_name, names)) || "";
        } catch (err) { console.warn("[ynab/transaction] local categorize failed:", err); }
      }

      db.prepare(`
        INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'cleared')
      `).run(user.id, id, txDate, signed, payee_name, categoryName, memo || "", account_id);
      db.prepare("UPDATE ynab_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?").run(signed, account_id);

      setHouseholdSetting("last_transaction_added", new Date().toISOString());
      eventBus.emit("data:updated", { source: "transaction-added", userId: user.id });
      console.info("[ynab/transaction] Local transaction created:", payee_name, signed, "cat:", categoryName || "uncategorized");
      return NextResponse.json({ success: true, id, category: categoryName ? "auto" : "uncategorized" });
    }

    const token = getYnabToken();
    const budgetId = getYnabBudgetId();
    if (!token || !budgetId) {
      return NextResponse.json({ error: "YNAB not connected" }, { status: 400 });
    }

    console.info("[ynab/transaction] Creating transaction:", payee_name, amount);

    // YNAB amounts are in milliunits (1000 = 1.00). Inflow is positive, outflow negative.
    const milliunits = Math.round(parseFloat(amount) * (inflow ? 1000 : -1000));

    // Auto-categorize outflows with no category. Inflows go to Ready to Assign, so leave them.
    let resolvedCategoryId = category_id || null;
    if (!resolvedCategoryId && !inflow) {
      try {
        const { getDb } = await import("@/lib/db");
        const db = getDb();
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const cats = db.prepare("SELECT name FROM ynab_categories WHERE month = ? AND name != 'Inflow: Ready to Assign'").all(currentMonth) as { name: string }[];
        const categoryNames = cats.map((c) => c.name);

        if (categoryNames.length > 0) {
          // A category name reviewed in the modal wins; otherwise fall back to an AI guess.
          const aiCategory = (typeof category === "string" && category) ? category : await aiCategorize(payee_name, categoryNames);
          if (aiCategory) {
            const found = db.prepare("SELECT ynab_id FROM ynab_categories WHERE month = ? AND name = ?").get(currentMonth, aiCategory) as { ynab_id: string } | undefined;
            if (found?.ynab_id) {
              resolvedCategoryId = found.ynab_id;
              console.info("[ynab/transaction] Resolved category from SQLite:", aiCategory, found.ynab_id);
            }
          }
        }
      } catch (err) {
        console.warn("[ynab/transaction] Category lookup failed:", err);
      }
    }

    const transaction: any = {
      account_id,
      date: date || new Date().toISOString().slice(0, 10),
      amount: milliunits,
      payee_name,
      cleared: "cleared",
      approved: true,
    };

    if (memo) transaction.memo = memo;
    if (resolvedCategoryId) transaction.category_id = resolvedCategoryId;

    const res = await fetch(`https://api.ynab.com/v1/budgets/${budgetId}/transactions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transaction }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[ynab/transaction] YNAB error:", res.status, text);
      return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
    }

    const data = await res.json();
    const createdTx = data.data?.transaction;
    console.info("[ynab/transaction] Transaction created:", createdTx?.id, "category:", resolvedCategoryId || "uncategorized");

    // Persist to local SQLite immediately so all users see it without waiting for sync
    if (createdTx) {
      try {
        const { getDb: getTxDb } = await import("@/lib/db");
        getTxDb().prepare(`
          INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'cleared')
          ON CONFLICT(ynab_id) DO UPDATE SET date=excluded.date, amount=excluded.amount, payee=excluded.payee, category=excluded.category, memo=excluded.memo, account_id=excluded.account_id
        `).run(user.id, createdTx.id, date || new Date().toISOString().slice(0, 10), parseFloat(amount) * (inflow ? 1 : -1), payee_name, createdTx.category_name || "", memo || "", account_id);
        console.info("[ynab/transaction] Persisted to local SQLite");
      } catch (err) {
        console.warn("[ynab/transaction] Failed to persist locally:", err);
      }
    }

    setHouseholdSetting("last_transaction_added", new Date().toISOString());
    eventBus.emit("data:updated", { source: "transaction-added", userId: user.id });

    return NextResponse.json({
      success: true,
      id: data.data?.transaction?.id,
      category: resolvedCategoryId ? "auto" : "uncategorized",
    });
  } catch (error) {
    console.error("[ynab/transaction] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { transaction_id, amount, payee_name, memo, account_id, date, category } = body;
    if (!transaction_id) return NextResponse.json({ error: "Transaction ID required" }, { status: 400 });
    // Inflow (income, or a positive-side transfer) is stored positive; default stays an outflow.
    const inflow = body.inflow === true;

    // LOCAL MODE: update local row, adjust account balance by the delta
    if (getBudgetMode() === "local") {
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      const prev = db.prepare("SELECT amount, account_id, category FROM transactions WHERE ynab_id = ?").get(transaction_id) as { amount: number; account_id: string; category: string } | undefined;
      const signed = inflow ? Math.abs(parseFloat(amount)) : parseFloat(amount) * -1;
      const newCategory = category !== undefined ? category : (prev?.category ?? "");
      db.prepare("UPDATE transactions SET amount = ?, payee = ?, memo = ?, account_id = ?, date = ?, category = ? WHERE ynab_id = ?")
        .run(signed, payee_name || "", memo || "", account_id || (prev?.account_id ?? ""), date || "", newCategory, transaction_id);
      if (prev) {
        // remove old amount from old account, add new to new account
        db.prepare("UPDATE ynab_accounts SET balance = balance - ? WHERE id = ?").run(prev.amount, prev.account_id);
        db.prepare("UPDATE ynab_accounts SET balance = balance + ? WHERE id = ?").run(signed, account_id || prev.account_id);
      }

      // Learn this payee as an internal-transfer payee so future Synci imports with the same payee
      // are recognized as transfers, not income. Skip the generic transfer descriptors.
      if (newCategory === INTERNAL_TRANSFER_CATEGORY) {
        const realPayee = (payee_name || "").trim();
        if (realPayee && !/^(transfer|starting balance|reconciliation)/i.test(realPayee)) {
          try {
            const rawList = getHouseholdSetting("internal_transfer_payees");
            const list: string[] = rawList ? JSON.parse(rawList) : [];
            if (!list.some((p) => p.toLowerCase() === realPayee.toLowerCase())) {
              list.push(realPayee);
              setHouseholdSetting("internal_transfer_payees", JSON.stringify(list));
              console.info("[ynab/transaction] Learned an internal-transfer payee");
            }
          } catch (e) {
            console.warn("[ynab/transaction] Failed to record internal-transfer payee:", e);
          }
        }
      }

      // Internal transfer with a chosen counterpart account: make sure the other leg exists so the
      // transfer shows on both accounts. Reuse an existing opposite-amount leg on that account (e.g.
      // one Synci imported) rather than creating a duplicate.
      const transferAcct = body.transfer_account_id ? String(body.transfer_account_id) : "";
      const thisAcct = account_id || prev?.account_id || "";
      if (transferAcct && transferAcct !== thisAcct && newCategory === INTERNAL_TRANSFER_CATEGORY) {
        const txDate = date || "";
        const counterSigned = -signed;
        const nameOf = (id: string) => (db.prepare("SELECT name FROM ynab_accounts WHERE id = ?").get(id) as { name: string } | undefined)?.name || "";
        const thisName = nameOf(thisAcct);
        const counterName = nameOf(transferAcct);
        const existing = db.prepare(
          "SELECT ynab_id FROM transactions WHERE account_id = ? AND ROUND(amount, 2) = ROUND(?, 2) AND category != 'Internal transfer' AND date BETWEEN date(?, '-2 days') AND date(?, '+2 days') LIMIT 1"
        ).get(transferAcct, counterSigned, txDate, txDate) as { ynab_id: string } | undefined;
        if (existing) {
          db.prepare("UPDATE transactions SET payee = ?, category = ? WHERE ynab_id = ?").run(`Transfer : ${thisName}`, INTERNAL_TRANSFER_CATEGORY, existing.ynab_id);
        } else {
          db.prepare("INSERT INTO transactions (user_id, ynab_id, date, amount, payee, category, memo, account_id, approved, cleared) VALUES (?, ?, ?, ?, ?, ?, '', ?, 1, 'cleared')")
            .run(user.id, `local_${randomUUID()}`, txDate, counterSigned, `Transfer : ${thisName}`, INTERNAL_TRANSFER_CATEGORY, transferAcct);
          db.prepare("UPDATE ynab_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?").run(counterSigned, transferAcct);
        }
        db.prepare("UPDATE transactions SET payee = ? WHERE ynab_id = ?").run(`Transfer : ${counterName}`, transaction_id);
      }

      eventBus.emit("data:updated", { source: "transaction-updated", userId: user.id });
      console.info("[ynab/transaction] Local transaction updated:", transaction_id);
      return NextResponse.json({ success: true });
    }

    const token = getYnabToken();
    const budgetId = getYnabBudgetId();
    if (!token || !budgetId) return NextResponse.json({ error: "YNAB not connected" }, { status: 400 });

    console.info("[ynab/transaction] Updating transaction:", transaction_id);

    const milliunits = Math.round(parseFloat(amount) * (inflow ? 1000 : -1000));
    const update: Record<string, unknown> = { id: transaction_id };
    if (amount !== undefined) update.amount = milliunits;
    if (payee_name !== undefined) update.payee_name = payee_name;
    if (memo !== undefined) update.memo = memo;
    if (account_id) update.account_id = account_id;
    if (date) update.date = date;

    // Resolve a chosen category name to YNAB's category id for the current month
    if (category !== undefined) {
      try {
        const { getDb } = await import("@/lib/db");
        const db = getDb();
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const found = db.prepare("SELECT ynab_id FROM ynab_categories WHERE month = ? AND name = ?").get(currentMonth, category) as { ynab_id: string } | undefined;
        if (found?.ynab_id) update.category_id = found.ynab_id;
      } catch (err) { console.warn("[ynab/transaction] Category resolve failed:", err); }
    }

    const res = await fetch(`https://api.ynab.com/v1/budgets/${budgetId}/transactions/${transaction_id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: update }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[ynab/transaction] YNAB update error:", res.status, text);
      return NextResponse.json({ error: "Failed to update transaction" }, { status: 500 });
    }

    // Update local SQLite
    try {
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      if (category !== undefined) {
        db.prepare("UPDATE transactions SET amount = ?, payee = ?, memo = ?, account_id = ?, date = ?, category = ? WHERE ynab_id = ?")
          .run(parseFloat(amount) * (inflow ? 1 : -1), payee_name || "", memo || "", account_id || "", date || "", category, transaction_id);
      } else {
        db.prepare("UPDATE transactions SET amount = ?, payee = ?, memo = ?, account_id = ?, date = ? WHERE ynab_id = ?")
          .run(parseFloat(amount) * (inflow ? 1 : -1), payee_name || "", memo || "", account_id || "", date || "", transaction_id);
      }
      console.info("[ynab/transaction] Local DB updated");
    } catch (err) {
      console.warn("[ynab/transaction] Local update failed:", err);
    }

    eventBus.emit("data:updated", { source: "transaction-added", userId: user.id });
    console.info("[ynab/transaction] Transaction updated:", transaction_id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ynab/transaction] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const transaction_id = body.transaction_id;
    if (!transaction_id) return NextResponse.json({ error: "Transaction ID required" }, { status: 400 });

    // LOCAL MODE: delete the row (and any split siblings) and reverse their balance effect
    if (getBudgetMode() === "local") {
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      const row = db.prepare("SELECT split_group FROM transactions WHERE ynab_id = ?").get(transaction_id) as { split_group: string } | undefined;
      const group = row?.split_group || "";
      // Reverse the summed amount of all rows being removed, then delete them
      if (group) {
        const rows = db.prepare("SELECT amount, account_id FROM transactions WHERE split_group = ?").all(group) as { amount: number; account_id: string }[];
        for (const r of rows) db.prepare("UPDATE ynab_accounts SET balance = balance - ? WHERE id = ?").run(r.amount, r.account_id);
        db.prepare("DELETE FROM transactions WHERE split_group = ?").run(group);
      } else {
        const prev = db.prepare("SELECT amount, account_id FROM transactions WHERE ynab_id = ?").get(transaction_id) as { amount: number; account_id: string } | undefined;
        db.prepare("DELETE FROM transactions WHERE ynab_id = ?").run(transaction_id);
        if (prev) db.prepare("UPDATE ynab_accounts SET balance = balance - ? WHERE id = ?").run(prev.amount, prev.account_id);
      }
      eventBus.emit("data:updated", { source: "transaction-deleted", userId: user.id });
      console.info("[ynab/transaction] Local transaction deleted:", transaction_id, group ? "(split group)" : "");
      return NextResponse.json({ success: true });
    }

    const token = getYnabToken();
    const budgetId = getYnabBudgetId();
    if (!token || !budgetId) return NextResponse.json({ error: "YNAB not connected" }, { status: 400 });

    const res = await fetch(`https://api.ynab.com/v1/budgets/${budgetId}/transactions/${transaction_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[ynab/transaction] YNAB delete error:", res.status, text);
      return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
    }
    try {
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      // Remove the row plus any local split siblings sharing its group
      db.prepare("DELETE FROM transactions WHERE ynab_id = ? OR split_group = ?").run(transaction_id, transaction_id);
    } catch (err) {
      console.warn("[ynab/transaction] Local delete failed:", err);
    }
    eventBus.emit("data:updated", { source: "transaction-deleted", userId: user.id });
    console.info("[ynab/transaction] Transaction deleted:", transaction_id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ynab/transaction] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
