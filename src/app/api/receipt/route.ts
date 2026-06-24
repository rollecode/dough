import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryClaudeWithImage } from "@/lib/ai/claude-image";
import { titleCasePayee } from "@/lib/text-utils";
import { localDateIso } from "@/lib/date-utils";

export async function POST(request: Request) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await request.json();
    const { image, media_type } = body;

    if (!image || !media_type) {
      return NextResponse.json({ error: "Image and media_type required" }, { status: 400 });
    }

    console.info("[receipt] Parsing receipt image for user", user.id);

    const today = localDateIso();
    const yesterday = localDateIso(new Date(Date.now() - 86400000));

    // Load YNAB account names for smart account detection
    const { getDb } = await import("@/lib/db");
    const receiptAccounts = getDb().prepare("SELECT name FROM ynab_accounts WHERE closed = 0").all() as { name: string }[];
    const accountNames = receiptAccounts.map((a) => a.name).join(", ");

    const prompt = `Extract ALL transactions/expenses from this receipt, invoice, or bank statement image.
For each transaction, extract:
- amount: the amount (number only, no currency symbol)
- payee: the store, company, or recipient name
- date: the ACTUAL date of the transaction in YYYY-MM-DD format. IMPORTANT date rules:
  - Today's date is ${today}
  - If you see "Tänään" or "Today" as a heading or label, use ${today}
  - If you see "Eilen" or "Yesterday", use ${yesterday}
  - If you see a specific date like "19.3." or "19.3.2026", convert to YYYY-MM-DD format (${today.slice(0, 4)} is the current year)
  - Transactions may be grouped under date headings — apply that heading's date to ALL transactions below it until the next heading
  - If absolutely no date is visible anywhere, use ${today}
- account: look for card brand, bank name, or app name (Revolut, Visa, Mastercard, S-Pankki, etc). Match to one of these YNAB accounts if possible: ${accountNames}. Use the exact YNAB account name. Leave empty if unclear.

If there is only ONE transaction, return a single-element array.
If there are MULTIPLE transactions (e.g. bank statement, multi-item list), return ALL of them with their correct dates.

Reply with ONLY a valid JSON array, nothing else:
[{"amount":"...","payee":"...","date":"YYYY-MM-DD","account":"..."}]

If you cannot read clearly, still try your best guess.`;

    const result = await queryClaudeWithImage(prompt, image, media_type);

    if (result.error) {
      console.error("[receipt] Parse error:", result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Extract JSON array or object from response
    let transactions: { amount: string; payee: string; date?: string; account?: string }[] = [];
    try {
      // Try array first
      const arrayMatch = result.text.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        transactions = JSON.parse(arrayMatch[0]);
      } else {
        // Fallback to single object
        const objMatch = result.text.match(/\{[\s\S]*\}/);
        if (objMatch) {
          transactions = [JSON.parse(objMatch[0])];
        }
      }
    } catch {
      console.warn("[receipt] Failed to parse JSON from:", result.text);
    }

    if (transactions.length === 0) {
      console.warn("[receipt] Could not parse receipt, raw:", result.text);
      return NextResponse.json({ error: "Could not read receipt", raw: result.text }, { status: 422 });
    }

    console.info("[receipt] Parsed", transactions.length, "transactions");

    // Normalize payee names to title case
    for (const tx of transactions) {
      if (tx.payee) tx.payee = titleCasePayee(tx.payee);
    }

    // Return both single-item backwards-compatible fields and full array
    return NextResponse.json({
      amount: transactions[0].amount,
      payee: transactions[0].payee,
      date: transactions[0].date,
      account: transactions[0].account || null,
      transactions,
    });
  } catch (error) {
    console.error("[receipt] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
