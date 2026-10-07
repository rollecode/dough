import { test } from "node:test";
import assert from "node:assert/strict";
import { spendingFlow } from "@/lib/spending-flow";

const base = {
  daysInMonth: 30,
  today: 10,
  dailyDiscretionary: 25,
  spentByDay: {} as Record<number, number>,
  budgetByDay: {} as Record<number, number>,
  incomeByDay: {} as Record<number, number>,
};

test("an overspend is counted once: the stretch keeps the budget it began with", () => {
  // 70 a day spent against 50, and each day's recorded budget falls with it.
  const spentByDay: Record<number, number> = {};
  const budgetByDay: Record<number, number> = {};
  for (let d = 1; d <= 10; d++) {
    spentByDay[d] = 70 * d;
    budgetByDay[d] = 50 - 2 * (d - 1);
  }
  const days = spendingFlow({ ...base, spentByDay, budgetByDay, dailyBudget: 32 });
  assert.equal(days[9].target, 500);
  assert.equal(days[9].spent, 700);
  assert.equal(days[13].target, 700);
});

test("money arriving starts a new stretch at that day's budget, from what has been spent", () => {
  const budgetByDay = { 1: 40, 2: 38, 3: 36, 4: 34, 5: 90, 6: 88 };
  const days = spendingFlow({ ...base, today: 7, spentByDay: { 4: 250 }, budgetByDay, dailyBudget: 85, incomeByDay: { 5: 800 } });
  assert.equal(days[3].target, 160);
  assert.equal(days[4].target, 250 + 90);
  assert.equal(days[6].target, 250 + 90 * 3);
});

test("money landing after the dashboard was opened is picked up the next day", () => {
  const budgetByDay = { 1: 40, 5: 30, 6: 90 };
  const days = spendingFlow({ ...base, today: 7, budgetByDay, dailyBudget: 85, incomeByDay: { 5: 800 } });
  assert.equal(days[4].target, 90);
});

test("a small refund does not start a new stretch", () => {
  const days = spendingFlow({ ...base, budgetByDay: { 1: 40, 5: 20 }, dailyBudget: 20, incomeByDay: { 5: 30 } });
  assert.equal(days[9].target, 400);
});

test("a stretch ends when the budget's 14-day window runs out", () => {
  const days = spendingFlow({ ...base, today: 20, spentByDay: { 14: 700 }, budgetByDay: { 1: 50, 15: 30 }, dailyBudget: 30 });
  assert.equal(days[13].target, 700);
  assert.equal(days[14].target, 700 + 30);
});

test("the projection starts where spending ends and carries on at the current rate", () => {
  const days = spendingFlow({ ...base, spentByDay: { 4: 100 }, dailyBudget: 30 });
  assert.equal(days[9].spent, 100);
  assert.equal(days[9].projected, 100);
  assert.equal(days[10].projected, 125);
  assert.equal(days[10].spent, null);
});
