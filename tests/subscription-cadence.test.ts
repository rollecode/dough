import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { createSubscription, updateSubscription } from "@/lib/subscriptions";
import { makeTargetResolver } from "@/lib/budget-math";
import { billDueInYearMonth } from "@/lib/bills";

const row = (id: number) =>
  getDb().prepare("SELECT interval_months, due_month FROM subscriptions WHERE id = ?").get(id) as { interval_months: number; due_month: number | null };

test("a subscription can recur yearly and falls due only in its month", () => {
  const created = createSubscription({ name: "Strava", amount: 69.99, due_day: 1, interval_months: 12, due_month: 10 });
  assert.ok("id" in created);
  const sub = row(created.id);
  assert.deepEqual(sub, { interval_months: 12, due_month: 10 });
  assert.equal(billDueInYearMonth(sub, "2026-10"), true);
  assert.equal(billDueInYearMonth(sub, "2026-11"), false);
  updateSubscription({ id: created.id, interval_months: 1 });
  assert.deepEqual(row(created.id), { interval_months: 1, due_month: null }, "back to monthly drops the month");
});

test("a category linked to a yearly subscription sets aside a twelfth a month", () => {
  const created = createSubscription({ name: "Yearly", amount: 120, due_day: 5, interval_months: 12, due_month: 3 });
  assert.ok("id" in created);
  const resolve = makeTargetResolver(getDb(), "2026-10");
  const target = resolve({ id: 999, subscription_id: created.id } as Parameters<typeof resolve>[0], 0);
  assert.equal(target.target_monthly, 10);
});
