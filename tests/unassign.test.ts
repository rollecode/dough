import { test } from "node:test";
import assert from "node:assert/strict";
import { planUnassign } from "@/lib/auto-assign";

const row = (id: number, budgeted: number, available: number, target = 0) =>
  ({ id, name: `c${id}`, budgeted, available, target, targetActive: target > 0 });

test("surplus over a target goes first, then untargeted, then targeted, largest first", () => {
  const rows = [row(1, 100, 100, 60), row(2, 50, 50), row(3, 80, 80), row(4, 70, 70, 70)];
  assert.deepEqual(planUnassign(150, rows), [
    { id: 1, name: "c1", take: 40 },
    { id: 3, name: "c3", take: 80 },
    { id: 2, name: "c2", take: 30 },
  ]);
});

test("never takes spent money or more than was assigned this month", () => {
  const rows = [row(1, 20, 90), row(2, 100, 10), row(3, 50, -5)];
  assert.deepEqual(planUnassign(500, rows), [
    { id: 1, name: "c1", take: 20 },
    { id: 2, name: "c2", take: 10 },
  ]);
});

test("nothing over-assigned takes nothing", () => {
  assert.deepEqual(planUnassign(0, [row(1, 10, 10)]), []);
});
