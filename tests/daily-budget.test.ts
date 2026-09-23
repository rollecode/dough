import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateDailyBudget } from "@/lib/daily-budget";

const resolveDay = (day: number) => day;
const salary = { amount: 4000, expectedDay: 30 };
const smallIncome = { amount: 99, expectedDay: 27 };

function budget(today: number, balance: number, extra: Partial<Parameters<typeof calculateDailyBudget>[0]> = {}) {
  return calculateDailyBudget({
    balance,
    savingGoal: 0,
    today,
    daysInMonth: 30,
    unpaidBills: [],
    debts: [],
    unreceivedIncomes: [salary, smallIncome].filter((i) => i.expectedDay > today),
    allIncomes: [salary, smallIncome],
    allBills: [],
    allDebts: [],
    resolveDay,
    ...extra,
  });
}

test("six days before payday the money is spread over seven days, not fourteen", () => {
  const result = budget(24, 350);
  assert.equal(result.tightestSegment?.days, 7);
  assert.equal(result.dailyBudget, 50);
});

test("a bill due before payday is still reserved", () => {
  const result = budget(24, 350, { unpaidBills: [{ amount: 21, dueDay: 26 }] });
  assert.equal(result.dailyBudget, 47);
});

test("a small income does not count as payday", () => {
  const result = budget(24, 350);
  assert.notEqual(result.tightestSegment?.days, 4);
});

test("right after payday the window stays fourteen days", () => {
  const result = budget(1, 700, { unreceivedIncomes: [salary, smallIncome] });
  assert.equal(result.tightestSegment?.days, 14);
  assert.equal(result.dailyBudget, 50);
});

test("without any income the window stays fourteen days", () => {
  const result = budget(24, 350, { unreceivedIncomes: [], allIncomes: [] });
  assert.equal(result.tightestSegment?.days, 14);
});
