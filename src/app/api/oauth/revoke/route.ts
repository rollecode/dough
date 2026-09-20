import { NextResponse } from "next/server";
import { revokeToken } from "@/lib/oauth";

// RFC 7009. Always answers 200: telling a caller whether a token existed would be a way to probe
// for valid ones.
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  let token = "";

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    token = String(body.token || "");
  } else {
    const form = await request.formData().catch(() => null);
    token = String(form?.get("token") || "");
  }

  if (token) revokeToken(token);
  return new NextResponse(null, { status: 200 });
}
