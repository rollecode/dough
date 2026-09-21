import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter, clientIp } from "@/lib/rate-limit";

test("a limiter blocks after max hits within the window", () => {
  const limiter = createLimiter(2, 60_000);
  assert.equal(limiter.isLimited("a"), false);
  limiter.record("a");
  limiter.record("a");
  assert.equal(limiter.isLimited("a"), true);
  assert.equal(limiter.isLimited("b"), false);
  limiter.reset("a");
  assert.equal(limiter.isLimited("a"), false);
});

test("clientIp prefers the Cloudflare header", () => {
  const req = new Request("http://localhost/", { headers: { "cf-connecting-ip": "203.0.113.1", "x-forwarded-for": "198.51.100.1, 10.0.0.1" } });
  assert.equal(clientIp(req), "203.0.113.1");
  assert.equal(clientIp(new Request("http://localhost/", { headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1" } })), "198.51.100.1");
  assert.equal(clientIp(new Request("http://localhost/")), "unknown");
});
