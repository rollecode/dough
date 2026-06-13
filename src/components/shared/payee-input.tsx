"use client";

import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";

interface PayeeInputProps {
  value: string;
  onChange: (value: string) => void;
  payees: string[];
  placeholder?: string;
  onBlur?: () => void;
}

// Payee field with a custom suggestions dropdown. Replaces the native <datalist>, which does
// not render reliably on mobile browsers (notably iOS Safari) — the suggestions list simply
// never appeared there. This dropdown selects on pointerdown so a touch tap registers before
// the input loses focus.
export function PayeeInput({ value, onChange, payees, placeholder, onBlur }: PayeeInputProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  const q = value.trim().toLowerCase();
  const matches = (q
    ? payees.filter((p) => p.toLowerCase().includes(q) && p.toLowerCase() !== q)
    : payees
  ).slice(0, 8);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        console.debug("[payee-input] outside pointerdown, closing suggestions");
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [open]);

  const choose = (p: string) => {
    console.debug("[payee-input] selected payee", p);
    onChange(p);
    setOpen(false);
    setHighlight(-1);
  };

  return (
    <div className="payee-autocomplete" ref={wrapRef}>
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete="off"
        onKeyDown={(e) => {
          if (!open || matches.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && highlight >= 0) { e.preventDefault(); choose(matches[highlight]); }
          else if (e.key === "Escape") { setOpen(false); }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="payee-autocomplete-list">
          {matches.map((p, i) => (
            <li key={p}>
              <button
                type="button"
                className={i === highlight ? "payee-autocomplete-option is-active" : "payee-autocomplete-option"}
                onPointerDown={(e) => { e.preventDefault(); choose(p); }}
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
