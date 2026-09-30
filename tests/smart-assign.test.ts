import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { smartQueue } from "@/lib/auto-assign";

test("smart assign covers overspending first, most-used first, then targets", () => {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (1, 'a@example.com', 'x')").run();
  const cat = db.prepare("INSERT INTO categories (name, group_name, sort_order) VALUES (?, 'G', ?)");
  const food = Number(cat.run("Food", 3).lastInsertRowid);
  const hobby = Number(cat.run("Hobby", 1).lastInsertRowid);
  const rent = Number(cat.run("Rent", 2).lastInsertRowid);
  db.prepare("INSERT INTO category_targets (category_id, monthly_amount) VALUES (?, 500)").run(rent);
  db.prepare("INSERT INTO category_targets (category_id, monthly_amount) VALUES (?, 300)").run(food);
  const spend = db.prepare("INSERT INTO transactions (user_id, date, amount, payee, category) VALUES (1, ?, ?, 'x', ?)");
  for (const day of ["01", "03", "05", "07"]) spend.run(`2026-09-${day}`, -10, "Food");
  spend.run("2026-09-02", -25, "Hobby");

  const cats = db.prepare("SELECT id, name, subscription_id, bill_id, debt_account_id, investment_account_id, savings_goal_id FROM categories").all() as Parameters<typeof smartQueue>[2];
  const queue = smartQueue(db, "2026-09", cats);

  assert.deepEqual(queue, [
    { id: food, want: 40 },
    { id: hobby, want: 25 },
    { id: food, want: 260 },
    { id: rent, want: 500 },
  ]);
});
