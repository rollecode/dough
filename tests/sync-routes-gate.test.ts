import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

// Timers reach the sync routes without a session; each route checks the timer secret itself.
test("sync timers are not sent to the login page", async () => {
  for (const path of ["/api/synci/sync", "/api/ynab/sync"]) {
    const res = await middleware(new NextRequest(`http://localhost${path}`, { method: "POST" }));
    assert.notEqual(res.status, 307, path);
  }
});
