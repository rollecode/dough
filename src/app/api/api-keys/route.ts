import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { generateApiKey } from "@/lib/api-auth";

interface KeyRow {
  id: number;
  name: string;
  key_prefix: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
}

// GET /api/api-keys - the keys this user owns, newest first. The key itself is never returned here:
// only its prefix, which is enough to recognise a key in a list.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const keys = getDb()
    .prepare(
      "SELECT id, name, key_prefix, scopes, created_at, last_used_at FROM api_keys " +
        "WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC"
    )
    .all(user.id) as KeyRow[];

  console.debug("[api-keys] Listing", keys.length, "keys");
  return NextResponse.json({ keys });
}

// POST /api/api-keys - mint a key for the signed-in user. Body: { name, scopes: "read" | "read,write" }.
// The plaintext key is in this response and nowhere else: the database keeps only its hash, so it
// cannot be shown again. Same generator as scripts/create-api-key.ts, so both hash identically.
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim() || "API key";
  const scopes = body.scopes === "read,write" ? "read,write" : "read";

  const { key, prefix, hash } = generateApiKey();
  const result = getDb()
    .prepare("INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes) VALUES (?, ?, ?, ?, ?)")
    .run(user.id, name, prefix, hash, scopes);

  console.info("[api-keys] Created key", prefix, "with scopes", scopes);

  return NextResponse.json({
    key,
    id: Number(result.lastInsertRowid),
    name,
    key_prefix: prefix,
    scopes,
    created_at: new Date().toISOString(),
    last_used_at: null,
  });
}
