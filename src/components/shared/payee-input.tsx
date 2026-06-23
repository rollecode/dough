"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";

interface PayeeInputProps {
  value: string;
  onChange: (value: string) => void;
  payees: string[];
  placeholder?: string;
  onBlur?: () => void;
  // Fired only when a suggestion is committed from the dropdown (click or Enter), not while typing.
  // Lets the caller advance focus to the next field once a payee is picked.
  onPick?: () => void;
}

// Payee/description field with a custom suggestions dropdown. The list is rendered in a portal
// with fixed positioning so it floats above a dialog instead of being clipped by the modal's
// overflow (which forced scrolling inside the modal to reach options). Selects on pointerdown so
// a touch tap registers before the input loses focus.
export function PayeeInput({ value, onChange, payees, placeholder, onBlur, onPick }: PayeeInputProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => setMounted(true), []);

  const q = value.trim().toLowerCase();
  const matches = (q
    ? payees.filter((p) => p.toLowerCase().includes(q) && p.toLowerCase() !== q)
    : payees
  ).slice(0, 8);

  // Position the floating list just below the field; keep it aligned while scrolling/resizing.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
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
    const onDocDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || listRef.current?.contains(t)) return;
      console.debug("[payee-input] outside pointerdown, closing suggestions");
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [open]);

  const choose = (p: string) => {
    console.debug("[payee-input] selected", p);
    onChange(p);
    setOpen(false);
    setHighlight(-1);
    onPick?.();
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
      {open && mounted && pos && matches.length > 0 && createPortal(
        <ul ref={listRef} className="payee-autocomplete-list" style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width }}>
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
        </ul>,
        document.body
      )}
    </div>
  );
}
