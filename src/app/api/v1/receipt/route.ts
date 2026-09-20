import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api-v1";
import { parseReceipt } from "@/lib/ai/receipt";

// POST /api/v1/receipt { image (base64), image_media_type } - read a photographed receipt and
// return what is on it. Nothing is written: the client shows the lines, the person confirms them,
// and the ordinary create endpoint records them.
export const POST = apiRoute("read", async (request) => {
  const body = await request.json().catch(() => ({}));
  const image = String(body.image || "");
  const mediaType = String(body.image_media_type || "");
  if (!image || !mediaType) {
    return NextResponse.json({ error: "image and image_media_type required" }, { status: 400 });
  }

  const lines = await parseReceipt(image, mediaType);
  const transactions = lines
    .map((line) => ({
      amount: Math.abs(parseFloat(String(line.amount).replace(",", "."))) || 0,
      payee: String(line.payee || "").trim(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(line.date || "")) ? String(line.date) : "",
      account: String(line.account || "").trim(),
    }))
    .filter((line) => line.amount > 0);

  console.info("[api/v1/receipt] read", transactions.length, "lines");
  return { transactions, count: transactions.length };
});
