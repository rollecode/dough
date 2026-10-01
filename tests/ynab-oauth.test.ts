import { test } from "node:test";
import assert from "node:assert/strict";
import { getHouseholdSetting, setHouseholdSetting } from "@/lib/household";
import { makeState, ynabToken } from "@/lib/ynab/oauth";

test("a pasted personal token is used as it is", async () => {
  setHouseholdSetting("ynab_access_token", "personal");
  assert.equal(await ynabToken(), "personal");
});

test("a signed-in token about to run out is renewed and stored", async () => {
  process.env.YNAB_CLIENT_ID = "id";
  process.env.YNAB_CLIENT_SECRET = "secret";
  setHouseholdSetting("ynab_access_token", "old");
  setHouseholdSetting("ynab_refresh_token", "refresh-1");
  setHouseholdSetting("ynab_token_expires_at", String(Date.now() + 10_000));
  const realFetch = globalThis.fetch;
  let sent = "";
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent = String(init.body);
    return new Response(JSON.stringify({ access_token: "new", refresh_token: "refresh-2", expires_in: 7200 }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await ynabToken(), "new");
    assert.match(sent, /grant_type=refresh_token/);
    assert.match(sent, /refresh_token=refresh-1/);
    assert.equal(getHouseholdSetting("ynab_refresh_token"), "refresh-2");
    assert.ok(Number(getHouseholdSetting("ynab_token_expires_at")) > Date.now() + 7_000_000);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.YNAB_CLIENT_ID;
    delete process.env.YNAB_CLIENT_SECRET;
  }
});

test("the state names the address to come back to", () => {
  const state = makeState("https://alpha.doughapp.cloud", "n1");
  assert.deepEqual(JSON.parse(Buffer.from(state, "base64url").toString()), { back: "https://alpha.doughapp.cloud", nonce: "n1" });
});
