import { queryClaudeWithImage } from "@/lib/ai/claude-image";
import { getDb } from "@/lib/db";
import { localDateIso } from "@/lib/date-utils";

export interface ParsedReceiptLine {
  amount: string;
  payee: string;
  date?: string;
  account?: string;
}

// One prompt for reading a receipt, shared by the chat's image path and the API, so a phone and a
// browser read the same photo the same way.
export async function parseReceipt(
  image: string,
  mediaType: string,
  timeoutMs = 30000
): Promise<ParsedReceiptLine[]> {
  const today = localDateIso();
  const yesterday = localDateIso(new Date(Date.now() - 86400000));
  const accounts = getDb().prepare("SELECT name FROM ynab_accounts WHERE closed = 0").all() as { name: string }[];
  const accountNames = accounts.map((a) => a.name).join(", ");

  const result = await queryClaudeWithImage(
    `Extract ALL transactions/expenses from this image. For each: amount (number only), payee/store name, date (YYYY-MM-DD), and account/card name if visible.
Today is ${today}. "Tänään"/"Today" = ${today}. "Eilen"/"Yesterday" = ${yesterday}. Convert dates like "19.3." to YYYY-MM-DD. Transactions under date headings inherit that date. If no date visible, use ${today}.
For "account": look for card brand, bank name, or app name (Revolut, Visa, Mastercard, S-Pankki, Nordea, OP, etc). Match to one of these YNAB accounts if possible: ${accountNames}. Use the exact YNAB account name. If unclear, leave empty.
If single receipt, return one item. If bank statement or multiple items, return ALL.
Reply with ONLY a valid JSON array: [{"amount":"...","payee":"...","date":"YYYY-MM-DD","account":"..."}]`,
    image,
    mediaType,
    timeoutMs
  );

  try {
    const array = result.text.match(/\[[\s\S]*\]/);
    if (array) return JSON.parse(array[0]) as ParsedReceiptLine[];
    const object = result.text.match(/\{[\s\S]*\}/);
    if (object) return [JSON.parse(object[0]) as ParsedReceiptLine];
  } catch {
    console.warn("[receipt] Could not parse the model's reply:", result.text);
  }
  return [];
}
