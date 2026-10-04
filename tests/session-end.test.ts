import { test } from "node:test";
import assert from "node:assert/strict";
import { createUser, createSession, verifySession, endSession } from "@/lib/auth";

test("a logged-out session stops working, other sessions do not", async () => {
  const id = Number(createUser("logout@example.com", "a-long-password", "Logout"));
  const phone = await createSession(id);
  const laptop = await createSession(id);
  assert.equal((await verifySession(phone))?.id, id);

  await endSession(phone);
  assert.equal(await verifySession(phone), null);
  assert.equal((await verifySession(laptop))?.id, id);
});
