"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/locale-context";

// How many months apart a bill or subscription falls, and past one, which month it falls in next.
// The interval is controlled so the month picker can appear the moment it goes above one.
export function RecurrenceFields({ interval, onInterval, dueMonth }: { interval: number; onInterval: (n: number) => void; dueMonth?: number | null }) {
  const { locale } = useLocale();
  return (
    <div className="form-grid-2">
      <div className="form-field">
        <Label>{locale === "fi" ? "Toistuu (kk välein)" : "Repeat every (months)"}</Label>
        <Input name="interval_months" type="number" min="1" max="120" value={String(interval)} onChange={(e) => onInterval(Math.max(1, parseInt(e.target.value, 10) || 1))} />
      </div>
      {interval > 1 && (
        <div className="form-field">
          <Label>{locale === "fi" ? "Seuraava erääntymiskuukausi" : "Next due month"}</Label>
          <select className="input" name="due_month" defaultValue={String(dueMonth || new Date().getMonth() + 1)}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleDateString(locale === "fi" ? "fi-FI" : "en-US", { month: "long" })}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// The form's interval and next due month, as the API takes them.
export function recurrenceFromForm(fd: FormData): { interval_months: number; due_month: number | null } {
  const interval = parseInt(fd.get("interval_months") as string, 10) || 1;
  return { interval_months: interval, due_month: interval > 1 ? parseInt(fd.get("due_month") as string, 10) : null };
}
