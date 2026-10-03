import { test } from "node:test";
import assert from "node:assert/strict";
import { burnRate, BURN_RATE_DAYS } from "@/lib/dashboard-model";

const spending = (t: { amount: number }) => t.amount < 0;
const now = new Date(2026, 9, 2);

test("the rate is the last 30 days' spending spread over 30 days, not the month so far", () => {
  const rows = [
    { date: "2026-10-02", amount: -30, payee: "K-Market" },
    { date: "2026-09-03", amount: -30, payee: "Lidl" },
    { date: "2026-09-02", amount: -900, payee: "Old" },
    { date: "2026-10-03", amount: -900, payee: "Future" },
  ];
  const rate = burnRate(rows, now, [], spending);
  assert.equal(rate.window_days, BURN_RATE_DAYS);
  assert.equal(rate.per_day, 2);
  assert.equal(Object.keys(rate.by_date).length, 30);
  assert.equal(rate.by_date["2026-10-02"], 30);
  assert.equal(rate.by_date["2026-09-03"], 30);
  assert.equal(rate.by_date["2026-09-02"], undefined);
});

test("an excluded payee is left out of the rate and the days, matched either way round", () => {
  const rows = [
    { date: "2026-10-01", amount: -1326.06, payee: "M2-KODIT OY" },
    { date: "2026-10-01", amount: -60, payee: "Wolt" },
  ];
  const rate = burnRate(rows, now, [" m2-kodit ", ""], spending);
  assert.equal(rate.per_day, 2);
  assert.equal(rate.by_date["2026-10-01"], 60);
  assert.deepEqual(rate.excluded_payees, ["m2-kodit"]);
});

test("what does not count as spending never enters the rate", () => {
  const rows = [{ date: "2026-10-01", amount: 300, payee: "Salary" }];
  assert.equal(burnRate(rows, now, [], spending).per_day, 0);
});
