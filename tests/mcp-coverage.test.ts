import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

// Every /api/v1 endpoint must be reachable as an MCP tool, so an assistant can do whatever the API
// allows. A new endpoint fails this until it has a tool.
const NOT_A_TOOL = new Set(["GET account/export"]); // a database file, not something to read in a chat

function routes(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routes(full, prefix ? `${prefix}/${entry.name}` : entry.name));
    else if (entry.name === "route.ts") {
      for (const m of fs.readFileSync(full, "utf8").matchAll(/export (?:const|async function) (GET|POST)\b/g)) found.push(`${m[1]} ${prefix}`);
    }
  }
  return found;
}

test("every v1 endpoint has an MCP tool", () => {
  const api = fs.readFileSync("src/lib/mcp/api.ts", "utf8");
  const tools = fs.readFileSync("src/lib/mcp/tools.ts", "utf8");
  const table = (name: string) => new Set([...api.slice(api.indexOf(name), api.indexOf("};", api.indexOf(name))).matchAll(/"([^"]+)":/g)].map((m) => m[1]));
  const reachable = { GET: table("GET_ROUTES"), POST: table("POST_ROUTES") };
  const called = { GET: new Set([...tools.matchAll(/api\.get\("([^"]+)"/g)].map((m) => m[1])), POST: new Set([...tools.matchAll(/api\.post\("([^"]+)"/g)].map((m) => m[1])) };

  const missing = routes("src/app/api/v1").filter((r) => {
    if (NOT_A_TOOL.has(r)) return false;
    const [method, route] = r.split(" ") as ["GET" | "POST", string];
    return !reachable[method].has(route) || !called[method].has(route);
  });
  assert.deepEqual(missing, []);
});
