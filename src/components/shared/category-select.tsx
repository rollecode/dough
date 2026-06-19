"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

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
// be by identity, since two groups can hold a category of the same name. Reuses the .cat-picker-*
// styles so it matches the expense-modal picker, and renders inline (in flow) so it works inside a
// dialog or sheet without a portal being read as an outside press.
export function CategorySelect({ value, onChange, categories, placeholder, searchPlaceholder, emptyLabel, fmt }: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? categories.filter((c) => c.name.toLowerCase().includes(ql) || (c.group_name || "").toLowerCase().includes(ql))
    : categories;

  const groups: { key: string; items: SelectableCategory[] }[] = [];
  for (const c of filtered) {
    const k = c.group_name || "";
    let g = groups.find((x) => x.key === k);
    if (!g) { g = { key: k, items: [] }; groups.push(g); }
    g.items.push(c);
  }

  const selected = categories.find((c) => String(c.id) === value);
  const choose = (id: string) => { onChange(id); setOpen(false); setQ(""); };
  const fmtAmt = (n: number) => (fmt ? fmt(n) : n.toFixed(2));

  return (
    <div className="cat-picker" ref={wrapRef}>
      <button type="button" className="cat-picker-trigger input" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className={selected ? "" : "cat-picker-placeholder"}>{selected ? selected.name : placeholder}</span>
        <ChevronDown className="icon-xs" />
      </button>
      {open && (
        <div className="cat-picker-panel">
          <input className="cat-picker-search input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} />
          <ul className="cat-picker-list">
            {groups.length === 0 && <li className="cat-picker-empty">{emptyLabel}</li>}
            {groups.map((g) => (
              <li key={g.key || "_ungrouped"}>
                {g.key && <div className="cat-picker-group">{g.key}</div>}
                {g.items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`cat-picker-option ${String(c.id) === value ? "is-active" : ""}`}
                    onClick={() => choose(String(c.id))}
                  >
                    <span className="cat-picker-name">{c.name}</span>
                    {typeof c.available === "number" && (
                      <span className={`cat-picker-amt ${c.available < -0.005 ? "is-neg" : c.available > 0.005 ? "is-pos" : ""}`}>{fmtAmt(c.available)} €</span>
                    )}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
