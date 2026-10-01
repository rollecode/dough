import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Credentials a household hands Dough (bank sync, YNAB, AI keys) are encrypted in the database when
// DOUGH_ENCRYPTION_KEY is set, so a copied database file or backup does not give them away. Without
// the key they are stored as they are, which is how a self-hosted instance has always worked.
// Values written before the key was set stay readable and are encrypted on their next write.

export const SECRET_SETTINGS = new Set([
  "ynab_access_token",
  "ynab_refresh_token",
  "synci_api_token",
  "gemini_api_key",
  "anthropic_api_key",
  "cron_secret",
]);

const PREFIX = "enc:v1:";

function key(): Buffer | null {
  const raw = process.env.DOUGH_ENCRYPTION_KEY;
  if (!raw) return null;
  const bytes = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new Error("DOUGH_ENCRYPTION_KEY must be 32 bytes, as 64 hex characters or base64");
  return bytes;
}

export function sealSecret(value: string): string {
  const k = key();
  if (!k) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function openSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const k = key();
  if (!k) throw new Error("A secret is encrypted but DOUGH_ENCRYPTION_KEY is not set");
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
