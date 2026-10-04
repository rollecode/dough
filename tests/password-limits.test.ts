import { test } from "node:test";
import assert from "node:assert/strict";
import { createUser } from "@/lib/auth";
import { deleteAccount } from "@/lib/account";

test("login stops an account being guessed from many made-up addresses", async () => {
  const { POST } = await import("@/app/api/auth/login/route");
  createUser("guess@example.com", "correct-horse-battery", "Guess");
  const attempt = (ip: string, password: string) =>
    POST(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email: "guess@example.com", password }),
    }));
  for (let i = 0; i < 20; i++) assert.equal((await attempt(`198.51.100.${i}`, "wrong")).status, 401);
  assert.equal((await attempt("203.0.113.9", "wrong")).status, 429);
  assert.equal((await attempt("203.0.113.10", "correct-horse-battery")).status, 429);
});

test("deleting an account stops answering after repeated wrong passwords", async () => {
  const id = Number(createUser("leaver@example.com", "right-password-1", "Leaver"));
  for (let i = 0; i < 5; i++) assert.equal(await deleteAccount(id, "wrong"), "wrong-password");
  assert.equal(await deleteAccount(id, "right-password-1"), "too-many-attempts");
});
