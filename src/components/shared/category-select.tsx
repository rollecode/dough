"use client";

import { SearchableSelect, type SearchableOption } from "./searchable-select";

export interface SelectableCategory {
  id: number;
  name: string;
  group_name?: string;
  available?: number;
}

interface CategorySelectProps {
  value: string;                    // selected category id as a string, "" when nothing is chosen
  onChange: (id: string) => void;
  categories: SelectableCategory[];
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;               // shown when the search matches no category
  fmt?: (n: number) => string;
}

// Searchable, budget-group-aware category dropdown keyed by category id. CategoryPicker is
// name-based (fine for tagging a transaction), but selecting a category to move money to/from must
// be by identity, since two groups can hold a category of the same name. A thin adapter over
// SearchableSelect that maps categories to options and shows each one's available amount.
export function CategorySelect({ value, onChange, categories, placeholder, searchPlaceholder, emptyLabel, fmt }: CategorySelectProps) {
  const fmtAmt = (n: number) => (fmt ? fmt(n) : n.toFixed(2));
  const options: SearchableOption[] = categories.map((c) => ({
    value: String(c.id),
    label: c.name,
    group: c.group_name,
    meta: typeof c.available === "number"
      ? <span className={`cat-picker-amt ${c.available < -0.005 ? "is-neg" : c.available > 0.005 ? "is-pos" : ""}`}>{fmtAmt(c.available)} €</span>
      : undefined,
  }));
  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyLabel={emptyLabel}
    />
  );
}
