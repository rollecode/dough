import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { deleteIncome } from "@/lib/income-write";

// POST /api/v1/income/delete (write). Body: { id }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteIncome(Number(body.id));
  return { success: true };
});
