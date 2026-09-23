import { test } from "node:test";
import assert from "node:assert/strict";
import { spendingFlow } from "@/lib/spending-flow";

const base = { daysInMonth: 30, today: 10, dailyDiscretionary: 25, spentByDay: {} as Record<number, number> };

test("a tight month reads over even when the month's income would cover it", () => {
  // 40 a day spent while the account only allows 20 a day until the late paycheck.
  const spentByDay: Record<number, number> = {};
  for (let d = 1; d <= 10; d++) spentByDay[d] = 40 * d;
  const days = spendingFlow({ ...base, spentByDay, dailyBudget: 20, budgetByDay: { 1: 20, 5: 20 } });
  const today = days[9];
  assert.equal(today.spent, 400);
  assert.equal(today.target, 200);
  assert.ok(today.spent! > today.target, "spending twice the allowance must read over");
});

test("a day nobody opened uses the earliest recorded budget, today the live one", () => {
  const days = spendingFlow({ ...base, dailyBudget: 50, budgetByDay: { 3: 30, 6: 40 } });
  // days 1-2 fall back to 30, 3 is 30, 4-5 fall back to 30, 6 is 40, 7-9 fall back to 30, 10 is live 50
  assert.equal(days[8].target, 30 * 8 + 40);
  assert.equal(days[9].target, 30 * 8 + 40 + 50);
});

test("the projection starts where spending ends and carries on at the current rate", () => {
  const days = spendingFlow({ ...base, spentByDay: { 4: 100 }, dailyBudget: 30, budgetByDay: {} });
  assert.equal(days[9].spent, 100);
  assert.equal(days[9].projected, 100);
  assert.equal(days[10].projected, 125);
  assert.equal(days[10].spent, null);
});
