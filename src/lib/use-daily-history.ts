"use client";

import { useEffect, useState } from "react";
import { useEvent } from "@/lib/use-events";

export interface DailyHistoryEntry {
  date: string;
  budget: number;
  spent: number;
  discretionary_target?: number;
}

// The streak and the burn rate read the same 31 days. One in-flight request is shared between
// them; a data:updated event drops it so the next mount refetches.
let cached: Promise<DailyHistoryEntry[]> | null = null;

function load(): Promise<DailyHistoryEntry[]> {
  if (!cached) {
    cached = fetch("/api/daily-budget-history")
      .then((r) => r.json())
      .then((d) => (d.history as DailyHistoryEntry[]) ?? [])
      .catch(() => []);
  }
  return cached;
}

export function useDailyHistory(): DailyHistoryEntry[] {
  const [history, setHistory] = useState<DailyHistoryEntry[]>([]);

  useEffect(() => {
    let alive = true;
    load().then((h) => { if (alive) setHistory(h); });
    return () => { alive = false; };
  }, []);

  useEvent("data:updated", () => {
    cached = null;
    load().then(setHistory);
  });

  return history;
}
