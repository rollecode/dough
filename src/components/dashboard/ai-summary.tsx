"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { RefreshCw, Sparkles, Copy, Check, EyeOff } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyToClipboard } from "@/lib/clipboard";

function relativeTime(dateStr: string, locale: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return locale === "fi" ? "hetki sitten" : "just now";
  if (diffMin < 60) return locale === "fi" ? `${diffMin} min sitten` : `${diffMin} min ago`;
  if (diffH === 1) return locale === "fi" ? "1 tunti sitten" : "1 hour ago";
  if (diffH < 24) return locale === "fi" ? `${diffH} tuntia sitten` : `${diffH} hours ago`;
  if (diffD === 1) return locale === "fi" ? "eilen" : "yesterday";
  return locale === "fi" ? `${diffD} pv sitten` : `${diffD}d ago`;
}

export function AiSummary() {
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryId, setSummaryId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const { locale } = useLocale();

  const fetchSummary = (refresh = false) => {
    console.info("[ai-summary] Fetching summary, refresh:", refresh);
    if (refresh) {
      setRefreshing(true);
      setSummary(null);
    } else {
      setLoading(true);
    }

    const params = new URLSearchParams({ locale });
    if (refresh) params.set("refresh", "1");

    fetch(`/api/summary?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.summary) {
          console.info("[ai-summary] Got summary, cached:", data.cached, "id:", data.id);
          setSummary(data.summary);
          setSummaryId(data.id ?? null);
          if (data.created_at) setCreatedAt(data.created_at);
        } else {
          setSummary(null);
          setSummaryId(null);
        }
      })
      .catch((err) => console.error("[ai-summary] Failed:", err))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    fetchSummary();
  }, [locale]);

  const handleCopy = () => {
    if (!summary) return;
    console.info("[ai-summary] Copying to clipboard");
    copyToClipboard(summary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRefresh = () => {
    console.info("[ai-summary] Refresh clicked");
    setRefreshing(true);
    setSummary(null);
    // Small delay so skeleton is visible even on fast cached responses
    setTimeout(() => fetchSummary(true), 300);
  };

  const handleHide = async () => {
    if (!summaryId) return;
    console.info("[ai-summary] Hiding summary id", summaryId);
    try {
      await fetch("/api/summary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: summaryId, is_hidden: 1 }),
      });
      // Refresh to show next non-hidden summary or none
      fetchSummary();
    } catch (err) {
      console.error("[ai-summary] Hide failed:", err);
    }
  };

  if (!loading && !summary && !refreshing) return null;

  return (
    <Card className="ai-summary-card">
      <div className="ai-summary-header">
        <div className="ai-summary-icon">
          <Sparkles />
          {createdAt && <span className="ai-summary-age">{locale === "fi" ? "AI-yhteenveto haettu " : "AI summary fetched "}{relativeTime(createdAt, locale)}</span>}
        </div>
        <div className="ai-summary-actions">
          {summary && (
            <button
              type="button"
              className="ai-summary-refresh"
              onClick={handleCopy}
            >
              {copied ? <Check /> : <Copy />}
            </button>
          )}
          {summary && summaryId !== null && (
            <button
              type="button"
              className="ai-summary-refresh"
              onClick={handleHide}
              title={locale === "fi" ? "Piilota tämä yhteenveto" : "Hide this summary"}
            >
              <EyeOff />
            </button>
          )}
          <button
            type="button"
            className="ai-summary-refresh"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      {refreshing || (loading && !summary) ? (
        <div className="skeleton-lines">
          <div className="skeleton-line skeleton-line-wide" />
          <div className="skeleton-line skeleton-line-medium" />
          <div className="skeleton-line skeleton-line-narrow" />
        </div>
      ) : summary ? (
        <div className="ai-summary-text"><ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown></div>
      ) : null}
    </Card>
  );
}
