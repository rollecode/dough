import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { createUser } from "@/lib/auth";
import { registerClient, issueCode, exchangeCode, refreshTokens, authenticateAccessToken, isAcceptableRedirectUri } from "@/lib/oauth";

const REDIRECT = "com.example.app:/callback";
const VERIFIER = "a".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const userId = Number(createUser("test@example.com", "password1234", "Test").lastInsertRowid ?? 1);

function newCode(clientId: string) {
  return issueCode({ clientId, userId, redirectUri: REDIRECT, scopes: ["read"], codeChallenge: CHALLENGE });
}

test("code exchange requires the matching PKCE verifier", () => {
  const client = registerClient("Test", [REDIRECT]);
  const bad = exchangeCode({ code: newCode(client.client_id), clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: "b".repeat(64) });
  assert.deepEqual(bad, { error: "invalid_grant" });

  const good = exchangeCode({ code: newCode(client.client_id), clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER });
  assert.ok("access_token" in good);
  assert.deepEqual(authenticateAccessToken(good.access_token), { userId, scopes: ["read"] });
});

test("a replayed code is rejected and revokes its tokens", () => {
  const client = registerClient("Test", [REDIRECT]);
  const code = newCode(client.client_id);
  const first = exchangeCode({ code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER });
  assert.ok("access_token" in first);

  const replay = exchangeCode({ code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER });
  assert.deepEqual(replay, { error: "invalid_grant" });
  assert.equal(authenticateAccessToken(first.access_token), null);
});

test("refresh tokens rotate and work only once", () => {
  const client = registerClient("Test", [REDIRECT]);
  const tokens = exchangeCode({ code: newCode(client.client_id), clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER });
  assert.ok("refresh_token" in tokens);

  const rotated = refreshTokens(tokens.refresh_token, client.client_id);
  assert.ok("access_token" in rotated);
  assert.deepEqual(refreshTokens(tokens.refresh_token, client.client_id), { error: "invalid_grant" });
});

test("redirect URIs are limited to app schemes and loopback", () => {
  assert.equal(isAcceptableRedirectUri(REDIRECT), true);
  assert.equal(isAcceptableRedirectUri("http://127.0.0.1:8080/cb"), true);
  assert.equal(isAcceptableRedirectUri("https://evil.example/cb"), false);
  assert.equal(isAcceptableRedirectUri("javascript:alert(1)"), false);
});
