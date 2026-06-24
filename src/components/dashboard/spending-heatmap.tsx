"use client";

import { Card } from "@/components/ui/card";
import { useLocale } from "@/lib/locale-context";
import { useEvent } from "@/lib/use-events";
import { useState, useEffect, useRef, useCallback } from "react";
import { isTransfer } from "@/lib/transaction-utils";
import { localDateIso } from "@/lib/date-utils";

interface HeatmapTransaction {
  date: string;
  payee: string;
  amount: number;
  category: string;
}

interface TooltipData {
  x: number;
  y: number;
  date: string;
  isFuture: boolean;
  total: number;
  top: { payee: string; amount: number }[];
}

export function SpendingHeatmap() {
  const { locale, fmt, mask } = useLocale();
  const [transactions, setTransactions] = useState<HeatmapTransaction[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const loadHeatmap = useCallback(() => {
    fetch("/api/heatmap")
      .then((r) => r.json())
      .then((data) => {
        if (data.transactions) {
          setTransactions(data.transactions.filter((t: HeatmapTransaction) => !isTransfer(t.payee, t.category)));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadHeatmap(); }, [loadHeatmap]);
  useEvent("data:updated", loadHeatmap);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
      }
    });
  }, [transactions]);

  const now = new Date();
  const today = localDateIso(now);

  const dailyData: Record<string, { total: number; top: { payee: string; amount: number }[] }> = {};
  for (const tx of transactions) {
    if (!dailyData[tx.date]) dailyData[tx.date] = { total: 0, top: [] };
    dailyData[tx.date].total += Math.abs(tx.amount);
    dailyData[tx.date].top.push({ payee: tx.payee, amount: Math.abs(tx.amount) });
  }
  for (const key of Object.keys(dailyData)) {
    dailyData[key].top.sort((a, b) => b.amount - a.amount);
  }

  // Use 90th percentile for color scaling so outliers like rent don't wash everything out
  const values = Object.values(dailyData).map((d) => d.total).sort((a, b) => a - b);
  const p90Index = Math.floor(values.length * 0.9);
  const maxSpend = values.length > 0 ? values[p90Index] || values[values.length - 1] : 1;

  const endDate = new Date(now);
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 44 * 7);
  const startDow = (startDate.getDay() + 6) % 7;
  startDate.setDate(startDate.getDate() - startDow);

  const weeks: { date: string; dateObj: Date }[][] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    if (weeks.length === 0 || weeks[weeks.length - 1].length === 7) {
      weeks.push([]);
    }
    weeks[weeks.length - 1].push({
      date: localDateIso(cursor),
      dateObj: new Date(cursor),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const monthLabels: { label: string; weekIndex: number }[] = [];
  let lastMonth = -1;
  for (let wi = 0; wi < weeks.length; wi++) {
    const firstDayInWeek = weeks[wi][0];
    if (firstDayInWeek) {
      const m = firstDayInWeek.dateObj.getMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        monthLabels.push({
          label: firstDayInWeek.dateObj.toLocaleDateString(locale === "fi" ? "fi" : "en", { month: "short" }),
          weekIndex: wi,
        });
      }
    }
  }

  const dayLabels = locale === "fi"
    ? ["", "ti", "", "to", "", "la", ""]
    : ["", "Tue", "", "Thu", "", "Sat", ""];

  function getIntensity(total: number): string {
    if (total === 0) return "heatmap-level-0";
    const ratio = total / maxSpend;
    if (ratio < 0.25) return "heatmap-level-1";
    if (ratio < 0.5) return "heatmap-level-2";
    if (ratio < 0.75) return "heatmap-level-3";
    return "heatmap-level-4";
  }

  const handleCellEnter = useCallback((e: React.MouseEvent, date: string, isFuture: boolean, total: number, top: { payee: string; amount: number }[]) => {
    if (!cardRef.current) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const cardRect = cardRef.current.getBoundingClientRect();
    setTooltip({
      x: rect.left + rect.width / 2 - cardRect.left,
      y: rect.top - cardRect.top,
      date,
      isFuture,
      total,
      top,
    });
  }, []);

  const handleCellLeave = useCallback(() => setTooltip(null), []);

  return (
    <Card className="spending-heatmap-card" ref={cardRef}>
      <h3 className="spending-heatmap-title">
        {locale === "fi" ? "Kulutuskartta" : "Spending heatmap"}
      </h3>
      <div className="spending-heatmap-scroll" ref={scrollRef}>
        <div className="spending-heatmap-grid">
          <div className="spending-heatmap-labels">
            {dayLabels.map((l, i) => (
              <span key={i} className="spending-heatmap-label">{l}</span>
            ))}
          </div>
          <div className="spending-heatmap-body">
            <div className="spending-heatmap-months">
              {monthLabels.map((ml, i) => (
                <span
                  key={i}
                  className="spending-heatmap-month"
                  style={{ gridColumnStart: ml.weekIndex + 1 }}
                >
                  {ml.label}
                </span>
              ))}
            </div>
            <div className="spending-heatmap-weeks">
              {weeks.map((week, wi) => (
                <div key={wi} className="spending-heatmap-week">
                  {week.map((cell, ci) => {
                    const data = dailyData[cell.date];
                    const total = data?.total || 0;
                    const isFuture = cell.date > today;
                    return (
                      <span
                        key={ci}
                        className={`spending-heatmap-cell ${isFuture ? "is-future" : getIntensity(total)}`}
                        onMouseEnter={(e) => handleCellEnter(e, cell.date, isFuture, total, data?.top || [])}
                        onMouseLeave={handleCellLeave}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {tooltip && (
        <div
          className="spending-heatmap-tooltip is-visible"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <span className="spending-heatmap-tooltip-date">
            {(() => { const [y, m, d] = tooltip.date.split("-"); return `${parseInt(d)}.${parseInt(m)}.${y}`; })()}
          </span>
          {tooltip.isFuture ? (
            <span className="spending-heatmap-tooltip-none">{locale === "fi" ? "tulossa" : "upcoming"}</span>
          ) : tooltip.total === 0 ? (
            <span className="spending-heatmap-tooltip-none">{locale === "fi" ? "ei kuluja" : "no spending"}</span>
          ) : (
            <>
              <span className="spending-heatmap-tooltip-total">{mask(fmt(tooltip.total))} €</span>
              {tooltip.top.slice(0, 3).map((t, ti) => (
                <span key={ti} className="spending-heatmap-tooltip-tx">
                  {t.payee}: {mask(fmt(t.amount))} €
                </span>
              ))}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
