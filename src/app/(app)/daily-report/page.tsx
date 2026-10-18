"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, MessageCircle, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocale } from "@/lib/locale-context";
import { dayHeading } from "@/lib/date-utils";
import { AMOUNT_KINDS } from "@/lib/amount-kinds";

// The end-of-day report: how the day went against its budget, written by the AI. Regenerate folds
// in transactions the bank sent late; "Chat about this" takes the report to Dougie.
export default function DailyReportPage() {
  const { locale, t } = useLocale();
  const router = useRouter();
  const fi = locale === "fi";
  const [report, setReport] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (data: { report?: string | null; date?: string | null; disabled?: boolean; error?: string }) => {
    setReport(data.report ?? null);
    setDate(data.date ?? null);
    setDisabled(!!data.disabled);
    setError(data.error ?? null);
  };

  useEffect(() => {
    console.debug("[daily-report] Loading", locale);
    setLoading(true);
    fetch(`/api/daily-report?locale=${locale}`)
      .then((r) => r.json())
      .then(apply)
      .catch((err) => console.error("[daily-report] Load failed:", err))
      .finally(() => setLoading(false));
  }, [locale]);

  const regenerate = () => {
    console.info("[daily-report] Regenerating", date);
    setRefreshing(true);
    fetch("/api/daily-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, locale }),
    })
      .then((r) => r.json())
      .then(apply)
      .catch((err) => console.error("[daily-report] Regenerate failed:", err))
      .finally(() => setRefreshing(false));
  };

  const chatAbout = () => {
    if (!report) return;
    const intro = fi ? "Kerro lisää tästä päivän raportista:" : "Tell me more about this daily report:";
    router.push(`/chat?ask=${encodeURIComponent(`${intro}\n\n${report}`)}`);
  };

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <div>
          <h1 className="page-heading">{t.nav.dailyReport}</h1>
          {date && <p className="page-subheading">{dayHeading(date, locale)}</p>}
        </div>
        <div className="sync-row">
          <Button variant="outline" size="sm" onClick={chatAbout} disabled={!report} title={fi ? "Keskustele tästä" : "Chat about this"}>
            <MessageCircle className="icon-sm" />
          </Button>
          <Button variant="outline" size="sm" onClick={regenerate} disabled={refreshing || !date} title={fi ? "Kirjoita uudelleen" : "Regenerate"}>
            <RefreshCw className={refreshing ? "icon-sm animate-spin" : "icon-sm"} />
          </Button>
        </div>
      </div>

      {loading || refreshing ? (
        <div className="page-loading">
          <Loader2 className="page-loading-spinner animate-spin" />
        </div>
      ) : disabled ? (
        <Card className="metric-card">
          <p className="text-muted">
            {fi ? "Päivän raportti on pois päältä. Voit laittaa sen päälle asetuksista." : "The daily report is off. You can turn it on in Settings."}
          </p>
        </Card>
      ) : report ? (
        <Card className="metric-card daily-report-card">
          <div className="daily-report-text">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              disallowedElements={["img"]}
              components={{
                a: ({ href, children }) => {
                  const kind = AMOUNT_KINDS[href ?? ""];
                  if (kind) return <strong className={kind}>{children}</strong>;
                  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
                },
              }}
            >
              {report}
            </ReactMarkdown>
          </div>
        </Card>
      ) : (
        <Card className="metric-card">
          <p className={error ? "form-error" : "text-muted"}>
            {error ?? (fi ? "Ei vielä raporttia tältä päivältä." : "No report for this day yet.")}
          </p>
        </Card>
      )}
    </div>
  );
}
