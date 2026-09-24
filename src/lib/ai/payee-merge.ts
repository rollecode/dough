import { quickAnswer } from "./quick-answer";

// Payees that are one merchant written several ways (case, a store number, a card terminal's
// suffix) and could be merged into one name. The model only proposes; nothing merges until a
// person accepts a group.

export interface MergeGroup {
  into: string;
  from: string[];
}

// The reply as groups, kept only where they are safe to offer: every name one of the payees, the
// target one of the group's own names rather than an invented spelling, at least one other name
// to merge, and no name in two groups.
export function parseMergeGroups(reply: string, names: string[]): MergeGroup[] {
  const json = reply.slice(reply.indexOf("["), reply.lastIndexOf("]") + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const known = new Set(names);
  const used = new Set<string>();
  const groups: MergeGroup[] = [];
  for (const entry of parsed) {
    const into = typeof entry?.into === "string" ? entry.into : "";
    if (!known.has(into) || used.has(into)) continue;
    const from = (Array.isArray(entry?.from) ? entry.from : [])
      .filter((name: unknown): name is string => typeof name === "string" && known.has(name) && name !== into && !used.has(name));
    const unique = [...new Set<string>(from)];
    if (unique.length === 0) continue;
    [into, ...unique].forEach((name) => used.add(name));
    groups.push({ into, from: unique });
  }
  return groups;
}

export async function suggestPayeeMerges(payees: { payee: string; uses: number }[]): Promise<MergeGroup[]> {
  if (payees.length < 2) return [];
  const names = payees.map((p) => p.payee);
  const prompt =
    "These are the payees in a household's transactions, each with how many times it is used. " +
    "Find payees that are the same merchant or person written differently: different case, a store " +
    "number, a city, a card terminal code or a company suffix. Do not group different merchants, and " +
    "do not group different branches of a chain unless only the spelling differs. For each group pick " +
    "the clearest existing name as the target, and when two are equally clear the one used most. " +
    "Reply with ONLY a JSON array like " +
    '[{"into":"Name to keep","from":["Other spelling","Another spelling"]}], or [] when there are none. ' +
    "Use the names exactly as written.\n\nPayees:\n" +
    payees.map((p) => `${p.payee} (${p.uses})`).join("\n");

  // A reply with no JSON array is no answer, so the CLI gets its turn.
  const groups = await quickAnswer("payee-merge", prompt, (reply) => (reply.includes("[") ? parseMergeGroups(reply, names) : null), {
    maxOutputTokens: 4000,
    timeoutMs: 90000,
  });
  return groups ?? [];
}
