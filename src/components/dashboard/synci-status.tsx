"use client";

import { useState, useEffect } from "react";
import { useLocale } from "@/lib/locale-context";
import { Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fi as fiFns, enUS } from "date-fns/locale";

// Passive heads-up when Synci is the data source (local mode): how long ago the bank last synced,
// plus weekend context, since bank postings lag and the displayed balances can trail reality.
export function SynciStatus() {
  const { locale } = useLocale();
  const [info, setInfo] = useState<{ mode: string; synci: boolean; lastSync: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/household")
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) setInfo({ mode: d.settings.data_mode, synci: !!d.settings.synci_connected, lastSync: d.settings.synci_last_sync || null });
      })
      .catch(() => {});
  }, []);

  if (!info || info.mode !== "local" || !info.synci) return null;

  const day = new Date().getDay();
  const isWeekend = day === 0 || day === 6;
  const last = info.lastSync ? new Date(info.lastSync) : null;
  const hoursSince = last ? (Date.now() - last.getTime()) / 3600000 : Infinity;

  // Only surface this when it's actually informative: on weekends (bank postings lag) or when the
  // last sync is getting old. On a normal weekday with the 30-minute timer it stays hidden.
  if (!isWeekend && hoursSince < 6) return null;

  const ago = last ? formatDistanceToNow(last, { addSuffix: false, locale: locale === "fi" ? fiFns : enUS }) : null;
  const syncLine = ago
    ? (locale === "fi" ? `Viimeisin pankkisynkronointi ${ago} sitten.` : `Last bank sync was ${ago} ago.`)
    : (locale === "fi" ? "Pankkia ei ole vielä synkronoitu." : "No bank sync yet.");
  const weekendLine = isWeekend
    ? (locale === "fi" ? " Viikonloppu - osa tapahtumista voi olla vielä kirjautumatta pankissa." : " It's the weekend, so some transactions may still be pending at the bank.")
    : "";

  return (
    <div className="synci-status">
      <Clock className="synci-status-icon" />
      <p className="synci-status-text">{syncLine}{weekendLine}</p>
    </div>
  );
}
