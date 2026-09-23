import { test } from "node:test";
import assert from "node:assert/strict";
import { averageDailySpend } from "@/lib/dashboard-model";

test("last month's spending is spread over all its days, quiet days included", () => {
  const spent = { "2026-08-01": 31, "2026-08-31": 31, "2026-09-02": 500, "2026-07-31": 900 };
  assert.equal(averageDailySpend(spent, new Date(2026, 8, 24)), 2);
});

test("January looks back to December", () => {
  assert.equal(averageDailySpend({ "2025-12-15": 62 }, new Date(2026, 0, 5)), 2);
});
