import { test } from "node:test";
import assert from "node:assert/strict";
import { spendingFlow } from "@/lib/spending-flow";

const base = {
  daysInMonth: 30,
  today: 10,
  dailyDiscretionary: 25,
  spentByDay: {} as Record<number, number>,
  paceByDay: {} as Record<number, number>,
  budgetByDay: {} as Record<number, number>,
  incomeByDay: {} as Record<number, number>,
};

test("an overspend is counted once: the stretch keeps the figure it began with", () => {
  // 70 a day spent against 50, and each day's recorded figure falls with it.
  const spentByDay: Record<number, number> = {};
  const paceByDay: Record<number, number> = {};
  for (let d = 1; d <= 10; d++) {
    spentByDay[d] = 70 * d;
    paceByDay[d] = 50 - 2 * (d - 1);
  }
  const { days, perDay } = spendingFlow({ ...base, spentByDay, paceByDay, paceTarget: 32 });
  assert.equal(days[9].target, 500);
  assert.equal(days[9].spent, 700);
  assert.equal(days[29].target, 1500);
  assert.equal(perDay, 50);
});

test("money arriving starts a new stretch at that day's figure, from what has been spent", () => {
  const paceByDay = { 1: 40, 2: 38, 3: 36, 4: 34, 5: 90, 6: 88 };
  const { days, perDay } = spendingFlow({ ...base, today: 7, spentByDay: { 4: 250 }, paceByDay, paceTarget: 85, incomeByDay: { 5: 800 } });
  assert.equal(days[3].target, 160);
  assert.equal(days[4].target, 250 + 90);
  assert.equal(days[6].target, 250 + 90 * 3);
  assert.equal(perDay, 90);
});

test("on the day money arrives the stretch's daily amount is reported, not the jump", () => {
  const { perDay } = spendingFlow({ ...base, today: 5, spentByDay: { 4: 250 }, paceByDay: { 1: 40 }, paceTarget: 90, incomeByDay: { 5: 800 } });
  assert.equal(perDay, 90);
});

test("money landing after the dashboard was opened is picked up the next day", () => {
  const paceByDay = { 1: 40, 5: 30, 6: 90 };
  const { perDay } = spendingFlow({ ...base, today: 7, paceByDay, paceTarget: 85, incomeByDay: { 5: 800 } });
  assert.equal(perDay, 90);
});

test("a small refund does not start a new stretch", () => {
  const paceByDay = { 1: 40, 5: 20 };
  const { perDay } = spendingFlow({ ...base, paceByDay, paceTarget: 20, incomeByDay: { 5: 30 } });
  assert.equal(perDay, 40);
});

test("days recorded before the pace figure existed fall back to the daily budget", () => {
  const { days } = spendingFlow({ ...base, budgetByDay: { 1: 60, 2: 55 }, paceTarget: 30 });
  assert.equal(days[9].target, 600);
});

test("the projection starts where spending ends and carries on at the current rate", () => {
  const { days } = spendingFlow({ ...base, spentByDay: { 4: 100 }, paceTarget: 30 });
  assert.equal(days[9].spent, 100);
  assert.equal(days[9].projected, 100);
  assert.equal(days[10].projected, 125);
  assert.equal(days[10].spent, null);
});
