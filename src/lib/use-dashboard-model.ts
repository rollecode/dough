"use client";

import { useEffect, useState } from "react";
import { useEvent } from "@/lib/use-events";
import type { DashboardModel } from "@/lib/dashboard-model";

// The pace line and the savings streak draw from the model the app reads. One in-flight request is
// shared between them; a data:updated event drops it so the next mount refetches.
let cached: Promise<DashboardModel | null> | null = null;

function load(): Promise<DashboardModel | null> {
  if (!cached) {
    cached = fetch("/api/dashboard-model")
      .then((r) => (r.ok ? r.json() : null))
      .catch((err) => {
        console.error("[dashboard-model] Load error:", err);
        return null;
      });
  }
  return cached;
}

export function useDashboardModel(): DashboardModel | null {
  const [model, setModel] = useState<DashboardModel | null>(null);

  useEffect(() => {
    let alive = true;
    load().then((m) => { if (alive) setModel(m); });
    return () => { alive = false; };
  }, []);

  useEvent("data:updated", () => {
    cached = null;
    load().then(setModel);
  });

  return model;
}
