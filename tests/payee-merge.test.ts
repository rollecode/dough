import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMergeGroups } from "@/lib/ai/payee-merge";

const names = ["K-Market Kamppi", "K-MARKET KAMPPI 123", "Kmarket kamppi", "Alepa", "Netflix", "NETFLIX.COM"];

test("groups keep only real payees and name one of their own as the target", () => {
  const raw = '```json\n[{"into":"K-Market Kamppi","from":["K-MARKET KAMPPI 123","Kmarket kamppi"]},{"into":"Netflix","from":["NETFLIX.COM"]}]\n```';
  assert.deepEqual(parseMergeGroups(raw, names), [
    { into: "K-Market Kamppi", from: ["K-MARKET KAMPPI 123", "Kmarket kamppi"] },
    { into: "Netflix", from: ["NETFLIX.COM"] },
  ]);
});

test("an invented name, a lone payee or a name used twice is dropped", () => {
  const raw = JSON.stringify([
    { into: "K Market", from: ["K-Market Kamppi"] },
    { into: "Alepa", from: [] },
    { into: "Netflix", from: ["NETFLIX.COM", "Spotify"] },
    { into: "NETFLIX.COM", from: ["Netflix"] },
  ]);
  assert.deepEqual(parseMergeGroups(raw, names), [{ into: "Netflix", from: ["NETFLIX.COM"] }]);
});

test("a reply that is not JSON gives no suggestions", () => {
  assert.deepEqual(parseMergeGroups("I could not decide.", names), []);
});
