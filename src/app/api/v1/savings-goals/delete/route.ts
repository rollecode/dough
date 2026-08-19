import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { deleteSavingsGoal } from "@/lib/savings-goals-write";

// POST /api/v1/savings-goals/delete (write) - delete a goal by id and clear its budget link. Body: { id }
export const POST = apiRoute("write", async (request) => {
  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteSavingsGoal(Number(body.id));
  return { success: true };
});
