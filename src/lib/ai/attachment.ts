// What the apps let a person attach: photos and PDFs, the same list the file pickers offer.
const ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
// 15 MB of base64 is about 11 MB of file, more than any phone photo or statement.
const MAX_ATTACHMENT_BASE64 = 15_000_000;

// Why an attachment cannot be read, or null when it can. Every AI image path checks this first.
export function attachmentProblem(data: string, mediaType: string): string | null {
  if (!ATTACHMENT_TYPES.has(mediaType)) return `Attach a JPEG, PNG, WebP or PDF, not ${mediaType || "an unknown type"}`;
  if (data.length > MAX_ATTACHMENT_BASE64) return "The attachment is too large: send one under 10 MB";
  return null;
}
