"use client";

import { Card } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart-container";
import { useLocale } from "@/lib/locale-context";
import { F } from "@/components/ui/f";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

export interface DebtSlice {
  id: string;
  name: string;
  balance: number;
  paidThisMonth: number;
  paidTotal: number;
  percentPaid: number;
  effectiveOriginal: number;
}

// Distinct, readable slice colors. Reused for the outer ring and the legend dots.
const DEBT_COLORS = ["#f87171", "#fb923c", "#fbbf24", "#c084fc", "#f472b6", "#60a5fa", "#34d399", "#a3a3a3"];

// Debt overview donut: the outer ring is each debt's remaining balance (one colour per debt); the
// inner ring is overall payoff progress (amount paid off vs still owed). The centre shows the total
// still owed and the overall percentage paid off. Beats a flat list: composition and progress at once.
export function DebtDonut({ debts }: { debts: DebtSlice[] }) {
  const { fmt, locale, mask } = useLocale();

  const withColor = debts
    .filter((d) => d.balance > 0)
    .map((d, i) => ({ ...d, color: DEBT_COLORS[i % DEBT_COLORS.length] }));
  if (withColor.length === 0) return null;

  const totalRemaining = withColor.reduce((s, d) => s + d.balance, 0);
  const totalOriginal = withColor.reduce((s, d) => s + d.effectiveOriginal, 0);
  const totalPaidOff = Math.max(0, totalOriginal - totalRemaining);
  const totalPaidThisMonth = withColor.reduce((s, d) => s + d.paidThisMonth, 0);
  const overallPercent = totalOriginal > 0 ? Math.min(100, Math.round((totalPaidOff / totalOriginal) * 1000) / 10) : 0;

  const progressData = [
    { name: locale === "fi" ? "Maksettu" : "Paid off", value: totalPaidOff, color: "var(--positive)" },
    { name: locale === "fi" ? "Jäljellä" : "Remaining", value: totalRemaining, color: "rgba(255,255,255,0.07)" },
  ];

  return (
    <Card className="debt-donut-card">
      <h3 className="debt-donut-title">{locale === "fi" ? "Velkojen erittely" : "Debt breakdown"}</h3>
      <div className="debt-donut-body">
        <div className="debt-donut-chart">
          <ChartContainer height={260}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={progressData} cx="50%" cy="50%" innerRadius={52} outerRadius={66} paddingAngle={1} dataKey="value" stroke="transparent" isAnimationActive={false}>
                  {progressData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Pie data={withColor} cx="50%" cy="50%" innerRadius={74} outerRadius={104} paddingAngle={2} dataKey="balance" stroke="transparent">
                  {withColor.map((entry) => (
                    <Cell key={entry.id} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as DebtSlice & { color?: string; name: string; value?: number };
                    // Inner progress ring slices have no debt id.
                    if (!("id" in d) || !d.id) {
                      return (
                        <div className="chart-tooltip">
                          <p className="chart-tooltip-value text-foreground">{d.name}</p>
                          <p className="chart-tooltip-label">{fmt(Number(d.value || 0))} €</p>
                        </div>
                      );
                    }
                    return (
                      <div className="chart-tooltip">
                        <p className="chart-tooltip-value text-foreground">{d.name}</p>
                        <p className="chart-tooltip-label">{fmt(d.balance)} € {locale === "fi" ? "jäljellä" : "left"} · {d.percentPaid}% {locale === "fi" ? "maksettu" : "paid"}</p>
                        {d.paidThisMonth > 0 && (
                          <p className="chart-tooltip-label">{locale === "fi" ? "Tässä kuussa" : "This month"}: {fmt(d.paidThisMonth)} €</p>
                        )}
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>
          <div className="debt-donut-center">
            <span className="debt-donut-total"><F v={totalRemaining} /></span>
            <span className="debt-donut-sub">{mask(`${overallPercent} %`)} {locale === "fi" ? "maksettu" : "paid off"}</span>
          </div>
        </div>
        <div className="debt-donut-legend">
          {withColor.map((d) => (
            <div key={d.id} className="debt-donut-legend-item">
              <div className="debt-donut-legend-top">
                <div className="debt-donut-legend-name">
                  <span className="debt-donut-legend-dot" style={{ backgroundColor: d.color }} />
                  <span className="debt-donut-legend-text">{d.name}</span>
                </div>
                <span className="debt-donut-legend-amount"><F v={d.balance} /></span>
              </div>
              <div className="debt-donut-legend-bar">
                <div className="debt-donut-legend-bar-fill" style={{ width: `${d.percentPaid}%`, backgroundColor: d.color }} />
              </div>
              <div className="debt-donut-legend-meta">
                <span>{mask(`${d.percentPaid} %`)} {locale === "fi" ? "maksettu" : "paid"}</span>
                {d.paidThisMonth > 0 && (
                  <span className="debt-donut-legend-month">+<F v={d.paidThisMonth} /> {locale === "fi" ? "tässä kuussa" : "this month"}</span>
                )}
              </div>
            </div>
          ))}
          {totalPaidThisMonth > 0 && (
            <div className="debt-donut-legend-total">
              {locale === "fi" ? "Maksettu yhteensä tässä kuussa" : "Paid this month in total"}: <F v={totalPaidThisMonth} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
