import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { deleteAccount } from "@/lib/account";

// POST /api/v1/account/delete { password } - deletes the key owner's account, and the household
// with it when they are its last member.
export const POST = apiRoute("write", async (request, identity) => {
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  const outcome = await deleteAccount(identity.userId, String(password ?? ""));
  if (outcome === "wrong-password") return NextResponse.json({ error: "Wrong password" }, { status: 403 });
  if (outcome === "too-many-attempts") return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  return { deleted: outcome };
});
