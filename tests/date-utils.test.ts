import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDayInMonth, nextOccurrence } from "@/lib/date-utils";

test("resolveDayInMonth clamps past the month end", () => {
  assert.equal(resolveDayInMonth(31, 2026, 5), 30);
  assert.equal(resolveDayInMonth(31, 2026, 1), 28);
  assert.equal(resolveDayInMonth(0, 2028, 1), 29);
  assert.equal(resolveDayInMonth(15, 2026, 0), 15);
});

test("nextOccurrence rolls to next month once the day has passed", () => {
  assert.deepEqual(nextOccurrence(10, new Date(2026, 8, 21)), new Date(2026, 9, 10));
  assert.deepEqual(nextOccurrence(25, new Date(2026, 8, 21)), new Date(2026, 8, 25));
  assert.deepEqual(nextOccurrence(31, new Date(2026, 0, 31)), new Date(2026, 0, 31));
});
