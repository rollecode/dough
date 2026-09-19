"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useLocale } from "@/lib/locale-context";
import { useMemo } from "react";

interface TrendData {
  category: string;
  categoryId?: number | null;
  thisMonth: number;
  lastMonth: number;
}

interface SpendingTrendsProps {
  trends: TrendData[];
}

// Below this a category has not really moved, it is just noise on a small base.
const MEANINGFUL_CHANGE = 0.1;

// Rows shown. Three keeps the card the same height as the heatmap beside it.
const MAX_ROWS = 3;

// Bars are scaled against this, so one runaway category cannot flatten every other bar.
const SCALE_CAP = 100;

export function SpendingTrends({ trends }: SpendingTrendsProps) {
  const { locale, fmt, mask } = useLocale();

  const movers = useMemo(() => {
    return trends
      .filter((t) => t.lastMonth > 0 && Math.abs(t.thisMonth - t.lastMonth) / t.lastMonth > MEANINGFUL_CHANGE)
      .map((t) => ({ ...t, pct: Math.round(((t.thisMonth - t.lastMonth) / t.lastMonth) * 100) }))
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
      .slice(0, MAX_ROWS);
  }, [trends]);

  if (movers.length === 0) {
    return (
      <Card className="spending-trends-card">
        <h3 className="spending-trends-title">{locale === "fi" ? "Trendi" : "Trend"}</h3>
        <p className="spending-trends-empty">{locale === "fi" ? "Ei tarpeeksi dataa vielä" : "Not enough data yet"}</p>
      </Card>
    );
  }

  const scale = Math.min(SCALE_CAP, Math.max(...movers.map((m) => Math.abs(m.pct))));
  const rising = movers.filter((m) => m.pct > 0).length;

  return (
    <Card className="spending-trends-card">
      <div className="spending-trends-head">
        <h3 className="spending-trends-title">{locale === "fi" ? "Trendi" : "Trend"}</h3>
        <span className="spending-trends-summary">
          {locale === "fi"
            ? `${mask(rising)} nousussa, ${mask(movers.length - rising)} laskussa`
            : `${mask(rising)} up, ${mask(movers.length - rising)} down`}
        </span>
      </div>

      <div className="spending-trends-rows">
        {movers.map((m) => {
          const up = m.pct > 0;
          const width = `${Math.min(100, (Math.abs(m.pct) / scale) * 100)}%`;
          return (
            <div key={m.category} className="trend-row">
              {m.categoryId ? (
                <Link className="trend-row-name" href={`/budget?cat=${m.categoryId}`} title={m.category}>
                  {m.category}
                </Link>
              ) : (
                <span className="trend-row-name" title={m.category}>{m.category}</span>
              )}
              <span className="trend-row-track">
                <span className={`trend-row-bar ${up ? "is-up" : "is-down"}`} style={{ width }} />
              </span>
              <span className={`trend-row-pct ${up ? "text-negative" : "text-positive"}`}>
                {up ? "+" : "−"}{mask(Math.abs(m.pct))}%
              </span>
            </div>
          );
        })}
      </div>

      <p className="spending-trends-foot">
        {mask(fmt(movers.reduce((s, m) => s + m.thisMonth, 0)))} €{" "}
        {locale === "fi" ? "tässä kuussa" : "this month"} ·{" "}
        {mask(fmt(movers.reduce((s, m) => s + m.lastMonth, 0)))} €{" "}
        {locale === "fi" ? "edelliskuussa tähän aikaan" : "same point last month"}
      </p>
    </Card>
  );
}
