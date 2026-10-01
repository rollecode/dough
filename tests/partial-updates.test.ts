import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db";
import { updateDebtOverride } from "@/lib/debts-write";

test("changing one debt field keeps the others", () => {
  updateDebtOverride({ ynab_account_id: "loan", interest_rate: 4.5, minimum_payment: 120, due_day: 15, notes: "car" });
  updateDebtOverride({ ynab_account_id: "loan", minimum_payment: 150 });
  updateDebtOverride({ ynab_account_id: "loan", is_priority: true });
  const row = getDb().prepare("SELECT interest_rate, minimum_payment, due_day, notes, is_priority FROM debt_overrides WHERE ynab_account_id = 'loan'").get();
  assert.deepEqual({ ...(row as object) }, { interest_rate: 4.5, minimum_payment: 150, due_day: 15, notes: "car", is_priority: 1 });
});
