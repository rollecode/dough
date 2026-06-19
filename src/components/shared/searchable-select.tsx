"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface SearchableOption {
  value: string;
  label: string;          // shown in the trigger when selected, and matched by the search
  group?: string;         // optional group heading; also matched by the search
  meta?: ReactNode;       // optional right-aligned content, e.g. an amount span
  search?: string;        // extra text to match against (defaults to label + group)
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;     // shown when the search matches nothing
}

// Generic searchable dropdown: a trigger plus an inline panel with a search box and a grouped,
// filterable option list. Inline (in flow) so it works inside a dialog or sheet without a portal
// being read as an outside press. Reuses the .cat-picker-* styles so every searchable picker (the
// expense-modal category picker, the budget move and link pickers) looks the same.
export function SearchableSelect({ value, onChange, options, placeholder, searchPlaceholder, emptyLabel }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Focus the search box on open so you can start typing to filter immediately.
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);

  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? options.filter((o) => (o.search ?? `${o.label} ${o.group || ""}`).toLowerCase().includes(ql))
    : options;

  const groups: { key: string; items: SearchableOption[] }[] = [];
  for (const o of filtered) {
    const k = o.group || "";
    let g = groups.find((x) => x.key === k);
    if (!g) { g = { key: k, items: [] }; groups.push(g); }
    g.items.push(o);
  }

  const selected = options.find((o) => o.value === value);
  const choose = (v: string) => { onChange(v); setOpen(false); setQ(""); };

  return (
    <div className="cat-picker" ref={wrapRef}>
      <button type="button" className="cat-picker-trigger input" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className={selected ? "" : "cat-picker-placeholder"}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className="icon-xs" />
      </button>
      {open && (
        <div className="cat-picker-panel">
          <input ref={searchRef} className="cat-picker-search input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} />
          <ul className="cat-picker-list">
            {groups.length === 0 && <li className="cat-picker-empty">{emptyLabel}</li>}
            {groups.map((g) => (
              <li key={g.key || "_ungrouped"}>
                {g.key && <div className="cat-picker-group">{g.key}</div>}
                {g.items.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`cat-picker-option ${o.value === value ? "is-active" : ""}`}
                    onClick={() => choose(o.value)}
                  >
                    <span className="cat-picker-name">{o.label}</span>
                    {o.meta != null && o.meta}
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
