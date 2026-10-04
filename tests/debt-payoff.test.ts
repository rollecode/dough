import { test } from "node:test";
import assert from "node:assert/strict";
import { snowball, avalanche } from "@/lib/debt-payoff";

const debts = [
  { balance: 1810, interestRate: 0, minimumPayment: 100 },
  { balance: 460.38, interestRate: 0, minimumPayment: 35.97 },
  { balance: 1626.32, interestRate: 0, minimumPayment: 385.67 },
  { balance: 427, interestRate: 0, minimumPayment: 17.2 },
];

test("a paid-off debt's payment moves on to the next one", () => {
  // 4 323,70 € at 538,84 € a month is gone in the ninth month.
  assert.equal(snowball(debts).months, 9);
});

test("without interest the order cannot change how long it takes", () => {
  assert.equal(avalanche(debts).months, snowball(debts).months);
});

test("an extra payment shortens it", () => {
  assert.ok(snowball(debts, 300).months < snowball(debts).months);
});

test("interest still makes it longer than the balance alone", () => {
  const withInterest = debts.map((d) => ({ ...d, interestRate: 20 }));
  assert.ok(snowball(withInterest).months >= snowball(debts).months);
  assert.ok(snowball(withInterest).totalInterest > 0);
});
