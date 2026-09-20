import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { eventBus } from "@/lib/event-bus";

const SOURCES = ["bill", "subscription", "income"] as const;
type Source = (typeof SOURCES)[number];

function isSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value);
}

// GET /api/v1/payee-matches[?source_type=&source_id=] - the payee patterns that settle a bill, a
// subscription or an income source when a matching transaction appears.
export const GET = apiRoute("read", (request) => {
  const params = new URL(request.url).searchParams;
  const where: string[] = [];
  const args: (string | number)[] = [];

  const sourceType = params.get("source_type");
  if (sourceType && isSource(sourceType)) {
    where.push("source_type = ?");
    args.push(sourceType);
  }
  const sourceId = params.get("source_id");
  if (sourceId) {
    where.push("source_id = ?");
    args.push(Number(sourceId));
  }

  const matches = getDb()
    .prepare(
      "SELECT id, source_type, source_id, payee_pattern, min_amount, max_amount FROM payee_matches " +
        (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
        "ORDER BY source_type, source_id"
    )
    .all(...args);

  return { matches, count: (matches as unknown[]).length };
});

// POST /api/v1/payee-matches { source_type, source_id, payee_pattern, min_amount?, max_amount? }
// adds one. Pass { id, delete: true } to remove one.
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  const db = getDb();

  if (body.delete === true) {
    if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
    db.prepare("DELETE FROM payee_matches WHERE id = ?").run(Number(body.id));
    eventBus.emit("data:updated", { source: "api-v1-payee-match-removed" });
    return { success: true, id: Number(body.id) };
  }

  const sourceType = String(body.source_type || "");
  if (!isSource(sourceType)) {
    return NextResponse.json({ error: `source_type must be one of ${SOURCES.join(", ")}` }, { status: 400 });
  }
  const sourceId = Number(body.source_id) || 0;
  const pattern = String(body.payee_pattern || "").trim();
  if (!sourceId || !pattern) {
    return NextResponse.json({ error: "source_id and payee_pattern required" }, { status: 400 });
  }

  const result = db
    .prepare(
      "INSERT INTO payee_matches (source_type, source_id, payee_pattern, min_amount, max_amount) VALUES (?, ?, ?, ?, ?)"
    )
    .run(sourceType, sourceId, pattern, Number(body.min_amount) || 0, Number(body.max_amount) || 0);

  eventBus.emit("data:updated", { source: "api-v1-payee-match-added" });
  return { success: true, id: Number(result.lastInsertRowid) };
});
