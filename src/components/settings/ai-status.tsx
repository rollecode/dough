"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { formatDate } from "@/lib/date-utils";
import type { AiStatus, AiServiceStatus } from "@/lib/ai/status";

const MODEL_NAMES: Record<string, string> = {
  "gemini-3-flash-preview": "Gemini 3 Flash",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  haiku: "Claude Haiku",
  sonnet: "Claude Sonnet",
  opus: "Claude Opus",
  claude: "Claude",
};

// Each AI service with a dot for whether it works, and how much of the month's AI it may still use.
export function AiStatusCard() {
  const { locale } = useLocale();
  const fi = locale === "fi";
  const [status, setStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    fetch("/api/ai/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch((err) => console.error("[ai-status] Load error:", err));
  }, []);

  const names: Record<AiServiceStatus["task"], string> = {
    chat: "Dougie",
    vision: fi ? "Kuitit" : "Receipts",
    categorize: fi ? "Kategorisointi" : "Categorizing",
    insight: fi ? "Yhteenvedot ja neuvot" : "Summaries and advice",
  };

  function stateText(s: AiServiceStatus): string {
    if (s.state === "off") return fi ? "Ei käytössä" : "Not set up";
    if (s.state === "failing") return fi ? "Ei toimi" : "Not working";
    if (s.lastAt) return fi ? "Toimii" : "Working";
    return fi ? "Valmis" : "Ready";
  }

  if (!status) return null;
  const used = status.limitUsedPercent;
  const anyOn = status.services.some((s) => s.state !== "off");
  const [y, m] = status.limitResets.split("-").map(Number);

  return (
    <Card className="settings-card">
      <CardHeader>
        <CardTitle className="settings-card-title">
          <Activity />
          {fi ? "Tekoälyn tila" : "AI status"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="ai-status-list">
          {status.services.map((s) => (
            <li key={s.task} className="ai-status-row" data-state={s.state}>
              <span className="ai-status-dot" aria-hidden="true" />
              <span className="ai-status-name">{names[s.task]}</span>
              <span className="ai-status-model">{MODEL_NAMES[s.model] ?? s.model}</span>
              <span className="ai-status-state">{stateText(s)}</span>
              {s.error && <span className="ai-status-error">{s.error}</span>}
            </li>
          ))}
          {anyOn && <li className="ai-status-row" data-state={used !== null && used >= 100 ? "off" : used !== null && used >= 80 ? "failing" : "ok"}>
            <span className="ai-status-dot" aria-hidden="true" />
            <span className="ai-status-name">{fi ? "Kuukauden raja" : "Monthly limit"}</span>
            <span className="ai-status-state">
              {used === null
                ? fi ? "Rajaton" : "Unlimited"
                : fi ? `${used} % käytetty, nollautuu ${formatDate(new Date(y, m - 1, 1))}` : `${used} % used, resets ${formatDate(new Date(y, m - 1, 1))}`}
            </span>
            {used !== null && (
              <span className="ai-status-meter" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={100}>
                <span className="ai-status-meter-fill" style={{ width: `${used}%` }} />
              </span>
            )}
          </li>}
        </ul>
      </CardContent>
    </Card>
  );
}
