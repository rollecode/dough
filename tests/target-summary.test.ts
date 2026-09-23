import { test } from "node:test";
import assert from "node:assert/strict";
import { targetSummary } from "@/lib/budget-math";

const cats = [
  { target_active: true, target_monthly: 400, budgeted: 400 },
  { target_active: true, target_monthly: 300, budgeted: 100 },
  { target_active: true, target_monthly: 50, budgeted: 80 },
  { target_active: false, target_monthly: 999, budgeted: 0 },
];

test("targets add up to funded plus still needed, over-funding does not count twice", () => {
  const s = targetSummary(cats, 1000);
  assert.deepEqual(s, { total: 750, funded: 550, stillNeeded: 200, expectedIncome: 1000, leftAfterTargets: 250 });
});

test("targets bigger than income leave a negative remainder", () => {
  assert.equal(targetSummary(cats, 600).leftAfterTargets, -150);
});
