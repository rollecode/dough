import { test } from "node:test";
import assert from "node:assert/strict";
import { isCronRequest, setHouseholdSetting } from "@/lib/household";

const request = (secret?: string) =>
  new Request("http://localhost/api/synci/sync", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} });

test("a timer is let in with the household's own secret or the server-wide one, never without", () => {
  setHouseholdSetting("cron_secret", "household-secret");
  process.env.DOUGH_CRON_SECRET = "server-secret";

  assert.equal(isCronRequest(request("household-secret")), true);
  assert.equal(isCronRequest(request("server-secret")), true);
  assert.equal(isCronRequest(request("guess")), false);
  assert.equal(isCronRequest(request()), false);

  delete process.env.DOUGH_CRON_SECRET;
  assert.equal(isCronRequest(request("server-secret")), false);
});
