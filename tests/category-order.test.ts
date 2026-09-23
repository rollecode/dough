import { test } from "node:test";
import assert from "node:assert/strict";
import { sortByGroupOrder } from "@/lib/category-order";

const rows = [
  { id: 1, group_name: "Bills" },
  { id: 2, group_name: "Bills" },
  { id: 3, group_name: "Daily" },
  { id: 4, group_name: null },
  { id: 5, group_name: "Savings" },
];

test("groups follow the saved order and keep their own row order", () => {
  const ids = sortByGroupOrder(rows, ["Daily", "Bills", ""]).map((r) => r.id);
  assert.deepEqual(ids, [3, 1, 2, 4, 5]);
});

test("without a saved order the rows stay as queried", () => {
  assert.deepEqual(sortByGroupOrder(rows, []).map((r) => r.id), [1, 2, 3, 4, 5]);
});
