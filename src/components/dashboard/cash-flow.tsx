"use client";

import { Card } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart-container";
import { useLocale } from "@/lib/locale-context";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface CashFlowData {
  month: string;
  income: number;
  expenses: number;
  net: number;
  upcomingIncome?: number;
}

interface CashFlowProps {
  data: CashFlowData[];
}

/* Custom bar shape: rounds top corners only when no upcoming income is stacked above */
function IncomeBarShape(props: { x?: number; y?: number; width?: number; height?: number; payload?: CashFlowData }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (height <= 0) return null;
  const r = payload?.upcomingIncome && payload.upcomingIncome > 0 ? 0 : 4;
  if (r === 0) return <rect x={x} y={y} width={width} height={height} fill="#4ade80" />;
  return (
    <path
      d={`M${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} L${x},${y + height} Z`}
      fill="#4ade80"
    />
  );
}

export function CashFlowChart({ data }: CashFlowProps) {
  const { t, locale, fmt, mask } = useLocale();

  function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string }>; label?: string }) {
    if (active && payload && payload.length) {
      const incomeEntry = payload.find((e) => e.dataKey === "income");
      const upcomingEntry = payload.find((e) => e.dataKey === "upcomingIncome");
      const expensesEntry = payload.find((e) => e.dataKey === "expenses");

      return (
        <div className="chart-tooltip">
          <p className="chart-tooltip-label chart-tooltip-value-mb">{label}</p>
          {incomeEntry && (
            <p className="chart-tooltip-value">
              <span style={{ color: "var(--positive)" }}>
                {t.dashboard.income}: {fmt(Math.abs(incomeEntry.value))} €
              </span>
            </p>
          )}
          {upcomingEntry && upcomingEntry.value > 0 && (
            <p className="chart-tooltip-value">
              <span style={{ color: "var(--positive)", opacity: 0.6 }}>
                {locale === "fi" ? "Tulossa" : "Upcoming"}: {fmt(Math.abs(upcomingEntry.value))} €
              </span>
            </p>
          )}
          {expensesEntry && (
            <p className="chart-tooltip-value">
              <span style={{ color: "var(--negative)" }}>
                {t.dashboard.expenses}: {fmt(Math.abs(expensesEntry.value))} €
              </span>
            </p>
          )}
        </div>
      );
    }
    return null;
  }

  return (
    <Card className="cash-flow-card">
      <h3 className="cash-flow-title">{t.dashboard.monthlyCashFlow}</h3>
      <ChartContainer height={280}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <pattern id="upcoming-income-pattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#4ade80" fillOpacity="0.15" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="#4ade80" strokeWidth="2" strokeOpacity="0.5" />
              </pattern>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: "#71717a", fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: "#71717a", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => mask(v >= 1000 ? `${(v/1000).toFixed(0)}k €` : `${Math.round(v)} €`)} width={50} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
            <Bar dataKey="income" stackId="income" shape={<IncomeBarShape />} barSize={20} />
            <Bar dataKey="upcomingIncome" stackId="income" fill="url(#upcoming-income-pattern)" radius={[4, 4, 0, 0]} barSize={20} />
            <Bar dataKey="expenses" fill="#f87171" radius={[4, 4, 0, 0]} barSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </Card>
  );
}
