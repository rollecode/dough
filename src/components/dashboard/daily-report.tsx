"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { RefreshCw, NotebookPen, MessageCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocale } from "@/lib/locale-context";
import { dayHeading } from "@/lib/date-utils";
import { AMOUNT_KINDS } from "@/lib/amount-kinds";

// The end-of-day report: how the day went, written by the AI. Regenerate folds in transactions the
// bank sent late; "Chat about this" takes it to Dougie.
export function DailyReport() {
  const { locale } = useLocale();
  const router = useRouter();
  const [report, setReport] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (data: { report?: string | null; date?: string | null; error?: string }) => {
    setReport(data.report ?? null);
    setDate(data.date ?? null);
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
    const intro = locale === "fi" ? "Kerro lisää tästä päivän raportista:" : "Tell me more about this daily report:";
    router.push(`/chat?ask=${encodeURIComponent(`${intro}\n\n${report}`)}`);
  };

  if (!loading && !report && !error) return null;

  return (
    <Card className="ai-summary-card">
      <div className="ai-summary-header">
        <div className="ai-summary-icon">
          <NotebookPen />
          <span className="ai-summary-age">
            {locale === "fi" ? "Päivän raportti" : "Daily report"}
            {date ? ` · ${dayHeading(date, locale)}` : ""}
          </span>
        </div>
        <div className="ai-summary-actions">
          {report && (
            <button type="button" className="ai-summary-refresh" onClick={chatAbout} title={locale === "fi" ? "Keskustele tästä" : "Chat about this"}>
              <MessageCircle />
            </button>
          )}
          <button
            type="button"
            className="ai-summary-refresh"
            onClick={regenerate}
            disabled={refreshing || !date}
            title={locale === "fi" ? "Kirjoita uudelleen" : "Regenerate"}
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      {refreshing || (loading && !report) ? (
        <div className="skeleton-lines">
          <div className="skeleton-line skeleton-line-wide" />
          <div className="skeleton-line skeleton-line-medium" />
          <div className="skeleton-line skeleton-line-narrow" />
        </div>
      ) : report ? (
        <div className="ai-summary-text">
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
      ) : (
        <p className="form-error">{error}</p>
      )}
    </Card>
  );
}
