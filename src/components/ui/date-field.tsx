"use client";

import { useRef, useState, useEffect } from "react";
import { useLocale } from "@/lib/locale-context";
import { CalendarDays } from "lucide-react";

// Parse text typed in the configured display format into an ISO date (YYYY-MM-DD).
// Returns "" for empty input and null when the text is not a complete valid date.
function toIso(text: string, dateFormat: string): string | null {
  const t = text.trim();
  if (!t) return "";
  let y: number, m: number, d: number;
  if (dateFormat === "yyyy-mm-dd") {
    const p = t.split("-").map(Number);
    if (p.length !== 3) return null;
    [y, m, d] = p;
  } else {
    const p = t.split(".").map(Number);
    if (p.length !== 3) return null;
    [d, m, y] = p;
  }
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? null : iso;
}

// A date input that displays and accepts the household's configured date format, with a
// themed native calendar picker. Works controlled (value + onChange) or in a plain form
// (pass name + defaultValue; the ISO value is submitted via a hidden field).
export function DateField({
  value,
  onChange,
  name,
  id,
  defaultValue,
  placeholder,
  className,
  required,
}: {
  value?: string;
  onChange?: (iso: string) => void;
  name?: string;
  id?: string;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  const { dateFormat, fmtDate, locale } = useLocale();
  // Hint the native calendar's locale so its week starts on Monday where the browser respects it
  // (Chromium/Android use the input's lang; iOS Safari follows the device region and ignores this).
  // "en-GB" is used for English so the default is a Monday start rather than Sunday.
  const pickerLang = locale === "fi" ? "fi" : "en-GB";
  const pickerRef = useRef<HTMLInputElement>(null);
  const controlled = value !== undefined;
  const [iso, setIso] = useState(value ?? defaultValue ?? "");
  const curIso = controlled ? value || "" : iso;
  const [text, setText] = useState(curIso ? fmtDate(curIso) : "");

  useEffect(() => { setText(curIso ? fmtDate(curIso) : ""); }, [curIso, dateFormat]);

  const setVal = (v: string) => {
    if (!controlled) setIso(v);
    onChange?.(v);
  };

  return (
    <div className="date-field">
      <input
        type="text"
        inputMode="numeric"
        id={id}
        className={`input date-field-text ${className || ""}`}
        value={text}
        placeholder={placeholder || dateFormat}
        required={required}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          const parsed = toIso(e.target.value, dateFormat);
          if (parsed !== null) { setVal(parsed); setText(parsed ? fmtDate(parsed) : ""); }
          else setText(curIso ? fmtDate(curIso) : "");
        }}
      />
      <span className="date-field-btn" aria-hidden="true">
        <CalendarDays />
      </span>
      <input
        ref={pickerRef}
        type="date"
        lang={pickerLang}
        className="date-field-native"
        aria-label={placeholder || "Date"}
        value={curIso}
        onChange={(e) => setVal(e.target.value)}
        onClick={(e) => { try { (e.currentTarget as HTMLInputElement).showPicker?.(); } catch { /* mobile opens on focus */ } }}
      />
      {name && <input type="hidden" name={name} value={curIso} />}
    </div>
  );
}
