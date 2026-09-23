import { test } from "node:test";
import assert from "node:assert/strict";
import { fixedCostMatcher } from "@/lib/fixed-costs";

const isFixed = fixedCostMatcher(["Netflix", "Sähkö"], ["Autolaina"]);

test("an uncategorised purchase is spending, not a bill", () => {
  assert.equal(isFixed("Lähikauppa", ""), false);
  assert.equal(isFixed("", ""), false);
});

test("a payee or category naming a bill or debt is a fixed cost", () => {
  assert.equal(isFixed("NETFLIX.COM 1234", ""), true);
  assert.equal(isFixed("Helen Oy", "Sähkö"), true);
  assert.equal(isFixed("Nordea", "Autolaina"), true);
  assert.equal(isFixed("Nordnet", "Sijoittaminen"), true);
});

test("ordinary spending stays spending", () => {
  assert.equal(isFixed("K-Market", "Ruokakauppa"), false);
});
