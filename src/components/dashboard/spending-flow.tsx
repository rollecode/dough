"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/locale-context";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";

interface SpendingFlowProps {
  spendingByDay: Record<number, number>;
  paidBillsAmount: number;
  daysInMonth: number;
  daysPassed: number;
  dailyDiscretionary: number;
  targetPerDay: number;
  dailyBudget: number;
}

interface SnapshotEntry {
  date: string;
  budget: number;
  spent: number;
  discretionary_target: number;
}

function ratioToColor(r: number): string {
  // r = actual/target. Under 1.0 = good, over = bad
  // 0-0.95 green, 0.95-1.0 green→yellow, 1.0-1.03 yellow→red, 1.03+ red
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const green = [74, 222, 128];
  const yellow = [250, 204, 21];
  const red = [248, 113, 113];
  if (r <= 0.95) return `rgb(${green.join(",")})`;
  if (r <= 1.0) {
    const t = clamp((r - 0.95) / 0.05, 0, 1);
    return `rgb(${lerp(green[0], yellow[0], t)},${lerp(green[1], yellow[1], t)},${lerp(green[2], yellow[2], t)})`;
  }
  if (r <= 1.03) {
    const t = clamp((r - 1.0) / 0.03, 0, 1);
    return `rgb(${lerp(yellow[0], red[0], t)},${lerp(yellow[1], red[1], t)},${lerp(yellow[2], red[2], t)})`;
  }
  return `rgb(${red.join(",")})`;
}

export function SpendingFlow({
  spendingByDay,
  paidBillsAmount,
  daysInMonth,
  daysPassed,
  dailyDiscretionary,
  targetPerDay,
  dailyBudget,
}: SpendingFlowProps) {
  const { locale, fmt } = useLocale();
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);

  useEffect(() => {
    fetch("/api/daily-budget-history")
      .then((r) => r.json())
      .then((data) => { if (data.history) setSnapshots(data.history); })
      .catch(() => {});
  }, []);

  // Build per-day target lookup from snapshots: day-of-month -> frozen target
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const snapshotByDay: Record<number, number> = {};
  for (const s of snapshots) {
    if (s.date.startsWith(monthPrefix) && s.discretionary_target > 0) {
      const day = parseInt(s.date.split("-")[2], 10);
      snapshotByDay[day] = s.discretionary_target;
    }
  }

  // Target = daily budget (from cash flow simulation) * days in month
  const target = dailyBudget * daysInMonth;

  // Cumulative target by day. Past days lock to their snapshot, falling back to the
  // earliest known snapshot value when no snapshot exists for that day. Today and future
  // use live targetPerDay so the in-progress day reflects current state.
  const earliestSnapshotTarget = (() => {
    const sorted = Object.keys(snapshotByDay).map(Number).sort((a, b) => a - b);
    for (const d of sorted) if (snapshotByDay[d] > 0) return snapshotByDay[d];
    return targetPerDay;
  })();
  const cumulativeTargetByDay: Record<number, number> = {};
  let runningTarget = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    let perDay: number;
    if (snapshotByDay[d] > 0) perDay = snapshotByDay[d];
    else if (d < daysPassed) perDay = earliestSnapshotTarget;
    else perDay = targetPerDay;
    runningTarget += perDay;
    cumulativeTargetByDay[d] = runningTarget;
  }

  const data: { day: number; label: string; actual?: number; projected?: number; target?: number }[] = [];
  let cumulative = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    if (d <= daysPassed) {
      cumulative = spendingByDay[d] || cumulative;
      // Actual = discretionary spending (cumulative minus already-paid bills) so
      // the line reflects daily decisions, not lumpy bill payments
      const discretionary = Math.max(0, cumulative - paidBillsAmount);
      data.push({
        day: d,
        label: `${d}.`,
        actual: discretionary,
        target: cumulativeTargetByDay[d] > 0 ? Math.round(cumulativeTargetByDay[d]) : undefined,
      });
    } else {
      const prev = data.length > 0 ? data[data.length - 1] : null;
      const lastVal = prev ? (prev.actual ?? prev.projected ?? 0) : 0;
      const projected = lastVal + dailyDiscretionary;
      data.push({
        day: d,
        label: `${d}.`,
        projected: Math.round(projected),
        target: cumulativeTargetByDay[d] > 0 ? Math.round(cumulativeTargetByDay[d]) : undefined,
      });
    }
  }

  if (daysPassed > 0 && daysPassed < daysInMonth) {
    data[daysPassed - 1].projected = data[daysPassed - 1].actual;
  }

  const lastActual = data[daysPassed - 1]?.actual || 0;
  const monthEndTarget = target > 0 ? target : 0;

  // Use cumulative snapshot for the "today" comparison so past target shifts don't move the bubble
  const cumulativeToToday = (() => {
    let sum = 0;
    for (let d = 1; d <= daysPassed; d++) {
      if (snapshotByDay[d] > 0) sum += snapshotByDay[d];
      else if (d < daysPassed) sum += earliestSnapshotTarget;
      else sum += targetPerDay;
    }
    return sum;
  })();
  const todayTarget = cumulativeToToday > 0 ? Math.round(cumulativeToToday) : 0;
  const todayDiff = todayTarget - lastActual;
  const todayRatio = todayTarget > 0 ? lastActual / todayTarget : 0;
  const ballColor = targetPerDay > 0 ? ratioToColor(todayRatio) : "#818cf8";

  const gradientStops = data.filter((d) => d.actual !== undefined).map((d, i, arr) => {
    const pos = arr.length > 1 ? i / (arr.length - 1) : 0.5;
    const dayTarget = cumulativeTargetByDay[d.day] || 0;
    const r = dayTarget > 0 ? (d.actual || 0) / dayTarget : 0;
    return { pos, color: ratioToColor(r) };
  });

  const bubbleLabel = targetPerDay > 0
    ? (todayDiff >= 0
      ? `${fmt(Math.abs(todayDiff))} € ${locale === "fi" ? "alle" : "under"}`
      : `${fmt(Math.abs(todayDiff))} € ${locale === "fi" ? "yli" : "over"}`)
    : `${fmt(lastActual)} € ${locale === "fi" ? "käytetty" : "spent"}`;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const isEndOfMonth = daysInMonth - daysPassed < 4;

  const renderDotLabel = (props: any) => {
    const { viewBox } = props;
    if (!viewBox) return null;
    const { x, y } = viewBox;

    const bw = bubbleLabel.length * 5.8 + 6;
    const bh = 20;
    const flipLeft = isEndOfMonth && typeof window !== "undefined" && window.innerWidth < 768;
    const bx = flipLeft ? x - bw + 4 : x + 8;
    const by = y - bh - 5;

    const tipPath = flipLeft
      ? `M${bx + bw - 2},${by + bh - 2} L${bx + bw - 9},${by + bh - 2} L${bx + bw - 2},${by + bh + 5} Z`
      : `M${bx + 2},${by + bh - 2} L${bx + 9},${by + bh - 2} L${bx + 2},${by + bh + 5} Z`;

    return (
      <g>
        <path d={tipPath} fill={ballColor} />
        <rect x={bx} y={by} width={bw} height={bh} rx={5} fill={ballColor} />
        <text
          x={bx + bw / 2}
          y={by + bh / 2 + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#0a0a10"
          fontSize={11}
          fontWeight={600}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {bubbleLabel}
        </text>
      </g>
    );
  };

  return (
    <div className={`spending-flow ${daysPassed <= 1 ? "is-first-day" : ""}`}>
      <div className="spending-flow-chart">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data} margin={{ top: 36, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="flowLineGrad" x1="0" y1="0" x2="1" y2="0">
                {gradientStops.map((s, i) => (
                  <stop key={i} offset={`${Math.round(s.pos * 100)}%`} stopColor={s.color} />
                ))}
              </linearGradient>
            </defs>
            <XAxis dataKey="label" hide />
            <YAxis hide />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const actual = payload.find((p) => p.dataKey === "actual" || p.dataKey === "projected");
                const targetEntry = payload.find((p) => p.dataKey === "target");
                const spentVal = Number(actual?.value || 0);
                const targetVal = Number(targetEntry?.value || 0);
                const diff = targetVal - spentVal;
                const diffColor = targetVal > 0 ? (diff >= 0 ? "var(--positive)" : "var(--negative)") : "var(--foreground)";
                const diffLabel = diff >= 0
                  ? `${fmt(Math.abs(diff))} € ${locale === "fi" ? "alle" : "under"}`
                  : `${fmt(Math.abs(diff))} € ${locale === "fi" ? "yli" : "over"}`;

                return (
                  <div className="chart-tooltip">
                    <p className="chart-tooltip-label">{label}</p>
                    {targetVal > 0 && <p className="chart-tooltip-value" style={{ color: diffColor }}>{diffLabel}</p>}
                    {actual && <p className="chart-tooltip-value" style={{ color: "var(--foreground)" }}>{locale === "fi" ? "Kulut tähän mennessä" : "Spent so far"}: {fmt(spentVal)} €</p>}
                    {targetEntry && <p className="chart-tooltip-value" style={{ color: "#4ade80" }}>{locale === "fi" ? "Vakaa kulutus olisi" : "Stable spending would be"}: {fmt(targetVal)} €</p>}
                  </div>
                );
              }}
            />
            {targetPerDay > 0 && (
              <Area
                type="monotone"
                dataKey="target"
                stroke="#4ade80"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                fill="none"
                dot={false}
                strokeOpacity={0.25}
              />
            )}
            <Area
              type="monotone"
              dataKey="projected"
              stroke="#71717a"
              strokeWidth={2}
              strokeDasharray="4 4"
              fill="none"
              dot={false}
              strokeOpacity={0.3}
            />
            <Area
              type="monotone"
              dataKey="actual"
              stroke="url(#flowLineGrad)"
              strokeWidth={5}
              fill="none"
              dot={false}
            />
            {daysPassed > 0 && (
              <ReferenceDot
                x={data[daysPassed - 1]?.label}
                y={lastActual}
                r={5}
                fill="#0a0a10"
                stroke={ballColor}
                strokeWidth={4}
                label={renderDotLabel}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
