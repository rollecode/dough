"use client";

import { useState, useEffect } from "react";
import { useLocale } from "@/lib/locale-context";
import { useTooltipTrigger } from "@/lib/use-tooltip-trigger";
import { Card } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart-container";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";

// Age of Money over time, sourced from YNAB's own per-month figure. Renders nothing until there
// are at least two months of data (so it stays hidden in local mode where YNAB hasn't synced it).
export function AgeOfMoneyChart() {
  const { locale } = useLocale();
  const tooltipTrigger = useTooltipTrigger();
  const [history, setHistory] = useState<{ month: string; age: number }[]>([]);
  const [current, setCurrent] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/age-of-money")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.history)) setHistory(d.history); if (typeof d.ageOfMoney === "number") setCurrent(d.ageOfMoney); })
      .catch(() => {});
  }, []);

  // Without enough history for a chart (e.g. local mode), still show the current figure as a stat
  if (history.length < 2) {
    if (current == null) return null;
    return (
      <Card className="list-card budget-aom-chart">
        <div className="budget-aom-chart-head">
          <span className="insp-section-title">{locale === "fi" ? "Rahan ikä" : "Age of money"}</span>
          <span className="budget-aom-stat">{current} {locale === "fi" ? "pv" : "days"}</span>
        </div>
        <p className="settings-help">{locale === "fi" ? "Arvio: kauanko rahasi riittää nykyisellä kulutuksella." : "Estimate: how long your money lasts at the current spending rate."}</p>
      </Card>
    );
  }

  const monthLabel = (m: string) => { const [y, mm] = m.split("-"); return `${parseInt(mm, 10)}/${y.slice(2)}`; };
  const hist = history.map((h) => ({ ...h, label: monthLabel(h.month) }));
  const maxAge = Math.max(...hist.map((h) => h.age), 0);
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const curInHist = hist.some((h) => h.month === cur);

  return (
    <Card className="list-card budget-aom-chart">
      <div className="budget-aom-chart-head">
        <span className="insp-section-title">{locale === "fi" ? "Rahan iän kehitys" : "Age of money over time"}</span>
        <span className="text-muted budget-aom-chart-range">{locale === "fi" ? `min 0 · max ${maxAge} pv` : `min 0 · max ${maxAge} days`}</span>
      </div>
      <ChartContainer height={180}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={hist} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: "#71717a", fontSize: 12 }} tickLine={false} axisLine={false} width={28} allowDecimals={false} domain={[0, (m: number) => Math.max(m, 10)]} />
            <Tooltip
              trigger={tooltipTrigger}
              cursor={{ stroke: "rgba(255,255,255,0.1)" }}
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "0.5rem", fontSize: "0.8125rem" }}
              labelStyle={{ color: "var(--muted-foreground)" }}
              formatter={(v) => [`${v} ${locale === "fi" ? "pv" : "days"}`, locale === "fi" ? "Rahan ikä" : "Age of money"]}
            />
            {curInHist && <ReferenceLine x={monthLabel(cur)} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" />}
            <Line type="monotone" dataKey="age" stroke="var(--chart-3, #f59e0b)" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
    </Card>
  );
}
