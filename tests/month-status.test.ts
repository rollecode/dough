import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { currentMonthStatus } from "@/lib/month-status";

test("a yearly or quarterly bill counts only in the month it falls due", () => {
  const db = getDb();
  const now = new Date(2026, 9, 8, 12);
  const user = db.prepare("INSERT INTO users (email, password_hash) VALUES ('month-status@example.com', 'x')").run().lastInsertRowid;
  db.prepare("INSERT INTO recurring_bills (user_id, name, amount, due_day) VALUES (?, 'Rent', 100, 5)").run(user);
  const before = currentMonthStatus(now).expenses;

  db.prepare("INSERT INTO recurring_bills (user_id, name, amount, due_day, cadence, due_month, interval_months) VALUES (?, 'Insurance', 500, 10, 'yearly', 4, 12)").run(user);
  db.prepare("INSERT INTO recurring_bills (user_id, name, amount, due_day, cadence, due_month, interval_months) VALUES (?, 'Water', 120, 10, 'monthly', 11, 3)").run(user);
  assert.equal(currentMonthStatus(now).expenses, before);

  db.prepare("INSERT INTO recurring_bills (user_id, name, amount, due_day, cadence, due_month, interval_months) VALUES (?, 'Domain', 70, 20, 'yearly', 10, 12)").run(user);
  assert.equal(currentMonthStatus(now).expenses, before + 70);
});
