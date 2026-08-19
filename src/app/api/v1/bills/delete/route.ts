import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { deleteBill } from "@/lib/bills-write";

// POST /api/v1/bills/delete (write) - delete a bill by id (and its status/history/patterns). Body: { id }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteBill(Number(body.id));
  return { success: true };
});
