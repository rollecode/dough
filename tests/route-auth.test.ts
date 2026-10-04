import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

// Routes that must answer without a browser session: signing in and out, and the OAuth endpoints
// a client calls before anyone is signed in.
const PUBLIC = new Set(["auth/login", "auth/logout", "oauth/token", "oauth/revoke", "oauth/register"]);

function routes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "v1" ? [] : routes(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

test("every web API route turns away a request without a session", () => {
  const unguarded = routes("src/app/api").filter((file) => {
    const name = path.relative("src/app/api", path.dirname(file));
    if (PUBLIC.has(name)) return false;
    const source = fs.readFileSync(file, "utf8");
    return !/const (\w+) = await getSession\(\);\s*\n\s*if \(!\1\)/.test(source);
  });
  assert.deepEqual(unguarded, []);
});
