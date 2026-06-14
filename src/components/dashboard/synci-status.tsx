"use client";

import { useState, useEffect } from "react";
import { useLocale } from "@/lib/locale-context";
import { Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fi as fiFns, enUS } from "date-fns/locale";

// Heads-up when Synci is the data source (local mode) and the bank sync is actually behind. Synci
// normally runs every 30 minutes and a no-op sync still refreshes the timestamp, so this stays
// hidden while syncing works - it only appears when transactions genuinely are not coming in.
const STALE_HOURS = 3;

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

  const last = info.lastSync ? new Date(info.lastSync) : null;
  const hoursSince = last ? (Date.now() - last.getTime()) / 3600000 : Infinity;
  if (hoursSince < STALE_HOURS) return null;

  const ago = last ? formatDistanceToNow(last, { addSuffix: false, locale: locale === "fi" ? fiFns : enUS }) : null;
  const text = ago
    ? (locale === "fi" ? `Pankki synkronoitu viimeksi ${ago} sitten. Tapahtumia voi puuttua, tarkista että kaikki on lisätty.` : `Bank last synced ${ago} ago. Some transactions may be missing - check everything is added.`)
    : (locale === "fi" ? "Pankkia ei ole vielä synkronoitu." : "No bank sync yet.");

  return (
    <div className="synci-status">
      <Clock className="synci-status-icon" />
      <p className="synci-status-text">{text}</p>
    </div>
  );
}
