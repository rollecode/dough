import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { setCategoryTarget } from "@/lib/categories-write";
import { makeTargetResolver } from "@/lib/budget-math";

function category(name: string): number {
  return Number(getDb().prepare("INSERT INTO categories (name, group_name) VALUES (?, 'Bills')").run(name).lastInsertRowid);
}
const input = (id: number) => ({ id, subscription_id: null, bill_id: null, debt_account_id: null, investment_account_id: null, savings_goal_id: null });

test("a monthly target can be due by a day of the month", () => {
  const id = category("Rent by day");
  assert.deepEqual(setCategoryTarget({ category_id: id, monthly_amount: 800, cadence: "monthly", due_day: 15 }), { ok: true });
  const t = makeTargetResolver(getDb(), "2026-10")(input(id), 0);
  assert.equal(t.target_due_day, 15);
  assert.equal(t.target_monthly, 800);
});

test("only a monthly target keeps a due day, and only 1 to 31", () => {
  const id = category("Groceries weekly");
  setCategoryTarget({ category_id: id, monthly_amount: 100, cadence: "weekly", due_day: 10 });
  assert.equal(makeTargetResolver(getDb(), "2026-10")(input(id), 0).target_due_day, null);
  assert.ok("error" in setCategoryTarget({ category_id: id, monthly_amount: 100, cadence: "monthly", due_day: 40 }));
});

test("leaving the due day out keeps it, and null clears it", () => {
  const id = category("Phone");
  setCategoryTarget({ category_id: id, monthly_amount: 30, cadence: "monthly", due_day: 20 });
  setCategoryTarget({ category_id: id, monthly_amount: 35 });
  assert.equal(makeTargetResolver(getDb(), "2026-10")(input(id), 0).target_due_day, 20);
  setCategoryTarget({ category_id: id, due_day: null });
  assert.equal(makeTargetResolver(getDb(), "2026-10")(input(id), 0).target_due_day, null);
});
