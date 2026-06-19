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
  // When provided, a typed name with no exact match offers a create row that persists a new
  // category and selects it. createLabel formats that row's text for the typed query.
  onCreate?: (name: string) => void;
  createLabel?: (name: string) => string;
  // Category names most likely for the current payee/description, shown first under a "Suggested"
  // heading so re-selecting is quick. Hidden while searching.
  suggestions?: string[];
  suggestionsLabel?: string;
}

// Budget-aware category picker: a custom dropdown that lists categories grouped by their budget
// group and shows each one's available amount. The panel renders inline (in flow) inside its
// wrapper, not in a body portal: inside a modal a body-portalled panel is treated as an outside
// press and dismisses the dialog, and a fixed-positioned panel drifts when the mobile keyboard
// resizes the viewport. Inline, the dialog simply scrolls to it. The search field is focused on
// open so you can type to filter immediately.
export function CategoryPicker({ value, onChange, categories, placeholder, noneLabel, searchPlaceholder, fmt, onCreate, createLabel, suggestions, suggestionsLabel }: CategoryPickerProps) {
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
  const exactMatch = categories.some((c) => c.name.toLowerCase() === ql);
  const canCreate = !!onCreate && ql.length > 0 && !exactMatch;
  const doCreate = (name: string) => { onCreate?.(name); onChange(name); setOpen(false); setQ(""); };
  // Most-likely categories for this payee/description, shown first while not searching.
  const byName = new Map(categories.map((c) => [c.name, c]));
  const suggested = (!ql && suggestions ? suggestions.map((n) => byName.get(n)).filter((c): c is PickerCategory => !!c) : []);

  return (
    <div className="cat-picker" ref={wrapRef}>
      <button type="button" className="cat-picker-trigger input" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className={value ? "" : "cat-picker-placeholder"}>{value || placeholder}</span>
        <ChevronDown className="icon-xs" />
      </button>
      {open && (
        <div className="cat-picker-panel">
          <input ref={searchRef} className="cat-picker-search input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} />
          <ul className="cat-picker-list">
            {suggested.length > 0 && (
              <li>
                <div className="cat-picker-group">{suggestionsLabel || "Suggested"}</div>
                {suggested.map((c) => (
                  <button
                    key={`sug-${c.name}`}
                    type="button"
                    className={`cat-picker-option ${c.name === value ? "is-active" : ""}`}
                    onClick={() => choose(c.name)}
                  >
                    <span className="cat-picker-name">{c.name}</span>
                    {typeof c.available === "number" && (
                      <span className={`cat-picker-amt ${c.available < -0.005 ? "is-neg" : c.available > 0.005 ? "is-pos" : ""}`}>{fmtAmt(c.available)} €</span>
                    )}
                  </button>
                ))}
              </li>
            )}
            {canCreate && (
              <li>
                <button type="button" className="cat-picker-option cat-picker-create" onClick={() => doCreate(q.trim())}>
                  <span className="cat-picker-name">{createLabel ? createLabel(q.trim()) : `+ ${q.trim()}`}</span>
                </button>
              </li>
            )}
            <li>
              <button type="button" className={`cat-picker-option ${value === "" ? "is-active" : ""}`} onClick={() => choose("")}>
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
                    onClick={() => choose(c.name)}
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
