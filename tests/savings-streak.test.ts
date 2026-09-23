import { test } from "node:test";
import assert from "node:assert/strict";
import { streakWeek } from "@/lib/savings-streak";

const now = new Date(2026, 8, 23, 12);
const row = (day: number, budget: number, spent: number) => ({ date: `2026-09-${String(day).padStart(2, "0")}`, budget, spent });

test("today under budget counts even when yesterday went over", () => {
  const week = streakWeek({ now, history: [row(22, 100, 150)], spentByDate: {}, dailyBudget: 187, todaySpent: 177 });
  assert.equal(week.current, 1);
});

test("each past day is judged against its own budget, and the ledger outranks the snapshot", () => {
  const history = [row(20, 50, 0), row(21, 50, 0), row(22, 50, 0)];
  const week = streakWeek({ now, history, spentByDate: { "2026-09-21": 80 }, dailyBudget: 100, todaySpent: 10 });
  assert.equal(week.current, 2);
  assert.equal(week.days[4].status, "fail");
});

test("a day with no record breaks the run", () => {
  const history = [row(20, 50, 10), row(22, 50, 10)];
  const week = streakWeek({ now, history, spentByDate: {}, dailyBudget: 100, todaySpent: 200 });
  assert.equal(week.current, 1);
  assert.equal(week.days.length, 7);
});
