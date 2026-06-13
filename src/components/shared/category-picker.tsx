"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
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
}

// Budget-aware category picker: a custom dropdown that lists categories grouped by their budget
// group and shows each one's available amount. The panel is rendered in a portal with fixed
// positioning so it floats above the dialog instead of being clipped inside it (which forced
// scrolling within the modal). Selects on pointerdown so it works on touch.
export function CategoryPicker({ value, onChange, categories, placeholder, noneLabel, searchPlaceholder, fmt, onCreate, createLabel }: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Position the floating panel just below the trigger; keep it aligned while scrolling/resizing.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
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
  const exactMatch = categories.some((c) => c.name.toLowerCase() === ql);
  const canCreate = !!onCreate && ql.length > 0 && !exactMatch;
  const doCreate = (name: string) => { onCreate?.(name); onChange(name); setOpen(false); setQ(""); };

  return (
    <div className="cat-picker">
      <button ref={triggerRef} type="button" className="cat-picker-trigger input" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className={value ? "" : "cat-picker-placeholder"}>{value || placeholder}</span>
        <ChevronDown className="icon-xs" />
      </button>
      {open && mounted && pos && createPortal(
        <div ref={panelRef} className="cat-picker-panel" style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width }}>
          <input className="cat-picker-search input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} />
          <ul className="cat-picker-list">
            {canCreate && (
              <li>
                <button type="button" className="cat-picker-option cat-picker-create" onPointerDown={(e) => { e.preventDefault(); doCreate(q.trim()); }}>
                  <span className="cat-picker-name">{createLabel ? createLabel(q.trim()) : `+ ${q.trim()}`}</span>
                </button>
              </li>
            )}
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
        </div>,
        document.body
      )}
    </div>
  );
}
