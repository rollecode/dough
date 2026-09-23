import { getHouseholdSetting } from "@/lib/household";

// The order the budget page lays groups out in, as the page saved it. Groups it never saw go last.
export function savedGroupOrder(): string[] {
  try {
    const order = JSON.parse(getHouseholdSetting("budget_group_order") || "[]");
    return Array.isArray(order) ? order.map(String) : [];
  } catch {
    return [];
  }
}

// Rows arrive ordered by group, sort_order and name; a stable sort by group keeps that within each.
export function sortByGroupOrder<T extends { group_name: string | null }>(rows: T[], order: string[]): T[] {
  if (order.length === 0) return rows;
  const rank = (name: string | null) => {
    const i = order.indexOf(name || "");
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...rows].sort((a, b) => rank(a.group_name) - rank(b.group_name));
}
