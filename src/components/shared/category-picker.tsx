"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

export interface PickerCategory {
  name: string;
  group_name?: string;
  available?: number;
}

interface CategoryPickerProps {
  value: string;
  onChange: (name: string) => void;
  categories: PickerCategory[];
  placeholder: string;
  noneLabel: string;
  searchPlaceholder: string;
  fmt?: (n: number) => string;
}

// Budget-aware category picker: a custom dropdown that lists categories grouped by their budget
// group and shows each one's available amount, instead of a bare native <select>. Selects on
// pointerdown so it works on touch. Shared by the add and edit transaction modals.
export function CategoryPicker({ value, onChange, categories, placeholder, noneLabel, searchPlaceholder, fmt }: CategoryPickerProps) {
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

  const groups: { key: string; items: PickerCategory[] }[] = [];
  for (const c of filtered) {
    const k = c.group_name || "";
    let g = groups.find((x) => x.key === k);
    if (!g) { g = { key: k, items: [] }; groups.push(g); }
    g.items.push(c);
  }

  const choose = (name: string) => { onChange(name); setOpen(false); setQ(""); };
  const fmtAmt = (n: number) => (fmt ? fmt(n) : n.toFixed(2));

  return (
    <div className="cat-picker" ref={wrapRef}>
      <button type="button" className="cat-picker-trigger input" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className={value ? "" : "cat-picker-placeholder"}>{value || placeholder}</span>
        <ChevronDown className="icon-xs" />
      </button>
      {open && (
        <div className="cat-picker-panel">
          <input className="cat-picker-search input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} />
          <ul className="cat-picker-list">
            <li>
              <button type="button" className={`cat-picker-option ${value === "" ? "is-active" : ""}`} onPointerDown={(e) => { e.preventDefault(); choose(""); }}>
                <span className="cat-picker-name">{noneLabel}</span>
              </button>
            </li>
            {groups.map((g) => (
              <li key={g.key || "_ungrouped"}>
                {g.key && <div className="cat-picker-group">{g.key}</div>}
                {g.items.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    className={`cat-picker-option ${c.name === value ? "is-active" : ""}`}
                    onPointerDown={(e) => { e.preventDefault(); choose(c.name); }}
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
