"use client";

import { useState, useEffect } from "react";
import { useLocale } from "@/lib/locale-context";
import { useTooltipTrigger } from "@/lib/use-tooltip-trigger";
import { useYnab } from "@/lib/ynab-context";
import { Card } from "@/components/ui/card";
import { localDateIso } from "@/lib/date-utils";
import { Button } from "@/components/ui/button";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
  CartesianGrid,
} from "recharts";
import { ChartContainer } from "@/components/ui/chart-container";
import { RefreshCw, TrendingUp, TrendingDown, Wallet, Loader2, LineChart } from "lucide-react";
import { F } from "@/components/ui/f";

interface Snapshot {
  date: string;
  checking: number;
  savings: number;
  investments: number;
  debts: number;
  net_worth: number;
}

function nwColor(value: number): string {
  if (value >= 0) return "rgb(74, 222, 128)";
  return "rgb(248, 113, 113)";
}

export default function NetWorthPage() {
  const { t, locale, fmt, mask } = useLocale();
  const tooltipTrigger = useTooltipTrigger();
  const { data: ynabData } = useYnab();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshotting, setSnapshotting] = useState(false);
  const [projectionRange, setProjectionRange] = useState(10);
  const [nwProjection, setNwProjection] = useState<{ timeline: { year: string; netWorth: number; baseline: number }[]; finalValue: number; totalGrowth: number } | null>(null);

  useEffect(() => {
    console.debug("[net-worth] Loading snapshots and investment data");
    Promise.all([
      fetch("/api/net-worth").then((r) => r.json()),
      fetch("/api/investments").then((r) => r.json()),
      fetch("/api/monthly-history").then((r) => r.json()),
      fetch("/api/debts").then((r) => r.json()),
    ]).then(([snapshotData, investData, historyData, debtData]) => {
      if (snapshotData.snapshots) {
        console.info("[net-worth] Loaded", snapshotData.snapshots.length, "snapshots");
        setSnapshots(snapshotData.snapshots);
      }

      // Net worth projection: model cash, investments, and debts separately
      const latestSnap = snapshotData.snapshots?.length > 0 ? snapshotData.snapshots[snapshotData.snapshots.length - 1] : null;
      const currentNw = latestSnap?.net_worth || 0;

      // Current components
      const investValue = (investData.investments || []).reduce((s: number, i: { balance: number }) => s + i.balance, 0);

      // Monthly flows
      const invs = investData.investments || [];
      const monthlyInvestContrib = invs.reduce((s: number, i: { monthlyContribution: number }) => s + i.monthlyContribution, 0);
      const monthlyDebtPayment = (debtData.debts || []).reduce((s: number, d: { minimumPayment: number }) => s + (d.minimumPayment || 0), 0);
      const wr = invs.length > 0
        ? (monthlyInvestContrib > 0
          ? invs.reduce((s: number, i: { expectedReturn: number; monthlyContribution: number }) => s + i.expectedReturn * i.monthlyContribution, 0) / monthlyInvestContrib
          : invs.reduce((s: number, i: { expectedReturn: number }) => s + i.expectedReturn, 0) / invs.length)
        : 0;
      const mr = wr / 100 / 12;

      // Exclude incomplete current month from average
      const history = (historyData.snapshots || []).filter((h: { month: string }) => {
        const now2 = new Date();
        return h.month !== `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, "0")}`;
      });
      // rawAvg = income - ALL expenses (already includes debt payments and invest contributions as expenses)
      // Debt reduction and investment growth are tracked separately in the simulation
      // So cash change = rawAvg (the net after everything)
      const rawAvg = history.length > 0
        ? history.reduce((s: number, h: { income: number; expenses: number }) => s + (h.income - h.expenses), 0) / history.length
        : 0;

      const currentYear = new Date().getFullYear();
      const tl: { year: string; netWorth: number; baseline: number }[] = [{ year: String(currentYear), netWorth: Math.round(currentNw), baseline: Math.round(currentNw) }];

      // --- Component model: cash + investments - debts each month ---
      // rawAvg = income - ALL_expenses (includes debt payments + invest contributions)
      // Cash changes by rawAvg each month
      // Investments: compound growth (contributions leave cash, enter investments)
      // Debts: snowball payoff (payments leave cash, reduce debts)
      // Net worth = cash + investments - debts (computed fresh each year)

      const debts = (debtData.debts || []) as { balance: number; interestRate: number; minimumPayment: number; monthlyTarget: number }[];
      const simDebts = debts
        .map((d) => ({ bal: d.balance, rate: (d.interestRate || 0) / 100 / 12, pay: d.minimumPayment || d.monthlyTarget || 50 }))
        .sort((a, b) => a.bal - b.bal);

      const cash0 = latestSnap ? latestSnap.checking + latestSnap.savings : 0;
      let cash = cash0;
      let inv1 = investValue, inv2 = investValue;

      for (let y = 1; y <= 20; y++) {
        for (let m = 0; m < 12; m++) {
          // Cash changes by rawAvg (net income - all expenses)
          cash += rawAvg;

          // After debts paid off, freed payments stay in cash (no longer leaving as debt payments)
          if (simDebts.every((d) => d.bal <= 0)) {
            cash += simDebts.reduce((s, d) => s + d.pay, 0);
          } else {
            // Snowball step (same as Velat tab)
            let extra = 0;
            for (const d of simDebts) {
              if (d.bal <= 0) { extra += d.pay; continue; }
              const interest = d.bal * d.rate;
              let payment = d.pay + (d === simDebts.find((x) => x.bal > 0) ? extra : 0);
              payment = Math.min(payment, d.bal + interest);
              d.bal = d.bal + interest - payment;
              if (d.bal < 1) d.bal = 0;
              extra = 0;
            }
          }

          // Investments compound (same as Sijoitukset tab)
          inv1 = inv1 * (1 + mr) + monthlyInvestContrib;
          inv2 += monthlyInvestContrib;
        }

        const debtLeft = simDebts.reduce((s, d) => s + Math.max(0, d.bal), 0);
        tl.push({
          year: String(currentYear + y),
          netWorth: Math.round(cash + inv1 - debtLeft),
          baseline: Math.round(cash + inv2 - debtLeft),
        });
      }

      const finalNw = tl[tl.length - 1].netWorth;
      setNwProjection({ timeline: tl, finalValue: finalNw, totalGrowth: finalNw - currentNw });
    })
      .catch((err) => console.error("[net-worth] Load error:", err))
      .finally(() => setLoading(false));
  }, []);

  const takeSnapshot = async () => {
    setSnapshotting(true);
    console.info("[net-worth] Taking snapshot");
    try {
      const res = await fetch("/api/net-worth", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setSnapshots((prev) => {
          const existing = prev.findIndex((s) => s.date === data.snapshot.date);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = data.snapshot;
            return updated;
          }
          return [...prev, data.snapshot];
        });
        console.info("[net-worth] Snapshot taken");
      }
    } catch (err) {
      console.error("[net-worth] Snapshot error:", err);
    } finally {
      setSnapshotting(false);
    }
  };

  // Current net worth from live account balances (present in both YNAB and local mode, via the
  // local cache). Used as a fallback when no historical snapshot exists yet, so the tab is never
  // blank just because no snapshot has been taken.
  const liveAccounts = ynabData?.summary?.accounts || [];
  const sumAcctType = (type: string) => liveAccounts.filter((a) => a.type === type).reduce((s, a) => s + a.balance, 0);
  const currentSnap: Snapshot | null = liveAccounts.length > 0 ? {
    date: localDateIso(),
    checking: sumAcctType("checking"),
    savings: sumAcctType("savings"),
    investments: sumAcctType("otherAsset"),
    debts: sumAcctType("otherDebt"),
    net_worth: Math.round(liveAccounts.reduce((s, a) => s + a.balance, 0) * 100) / 100,
  } : null;

  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : currentSnap;

  // Change since earliest available snapshot
  const compareSnapshot = snapshots.length >= 2 ? snapshots[0] : null;
  const changeAmount = latest && compareSnapshot ? latest.net_worth - compareSnapshot.net_worth : null;
  const changeDays = latest && compareSnapshot
    ? Math.round((new Date(latest.date).getTime() - new Date(compareSnapshot.date).getTime()) / 86400000)
    : 0;

  // Total investments
  const totalInvestments = latest ? latest.investments : 0;

  // Chart data — deduplicate per day, keep latest snapshot
  const byDay = new Map<string, Snapshot>();
  for (const s of snapshots) {
    byDay.set(s.date, s);
  }
  const uniqueSnapshots = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const chartData: { date: string; netWorth?: number; forecast?: number }[] = uniqueSnapshots.map((s) => ({
    date: `${parseInt(s.date.split("-")[2], 10)}.${parseInt(s.date.split("-")[1], 10)}`,
    netWorth: Math.round(s.net_worth),
  }));

  // Forecast: use full history trend + extend 14 days
  if (uniqueSnapshots.length >= 2 && latest) {
    const first = uniqueSnapshots[0];
    const totalDays = Math.max(1, (new Date(latest.date).getTime() - new Date(first.date).getTime()) / 86400000);
    const dailyTrend = (latest.net_worth - first.net_worth) / totalDays;

    // Bridge point
    chartData[chartData.length - 1].forecast = Math.round(latest.net_worth);

    const lastDate = new Date(latest.date);
    for (let d = 1; d <= 14; d++) {
      const forecastDate = new Date(lastDate);
      forecastDate.setDate(forecastDate.getDate() + d);
      chartData.push({
        date: `${forecastDate.getDate()}.${forecastDate.getMonth() + 1}`,
        forecast: Math.round(latest.net_worth + dailyTrend * d),
      });
    }
  }

  // Dynamic gradient stops for the line
  const actualPoints = chartData.filter((d) => d.netWorth !== undefined);
  const gradientStops = actualPoints.map((d, i, arr) => {
    const pos = arr.length > 1 ? i / (arr.length - 1) : 0.5;
    return { pos, color: nwColor(d.netWorth!) };
  });

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <h1 className="page-heading">{t.dashboard.netWorth}</h1>
        <div className="sync-row">
          <Button variant="outline" size="sm" onClick={takeSnapshot} disabled={snapshotting}>
            <RefreshCw className={snapshotting ? "icon-sm animate-spin" : "icon-sm"} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">
          <Loader2 className="page-loading-spinner animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary paragraph */}
          {latest && (
            <div className="personal-greeting"><p className="personal-greeting-text">
              {changeAmount !== null && changeAmount !== 0 && changeDays > 0 ? (
                <>
                  {locale === "fi" ? "Varallisuuden muutos " : "Net worth change "}
                  <span style={{ color: changeAmount > 0 ? "var(--positive)" : "var(--negative)" }}>
                    {changeAmount > 0 ? "+" : ""}<F v={changeAmount} s=" €" />
                  </span>
                  {locale === "fi" ? ` edellisten ${changeDays} päivän aikana.` : ` over the past ${changeDays} days.`}
                </>
              ) : changeAmount === 0 && changeDays > 0 ? (
                <>{locale === "fi" ? "Varallisuus pysynyt samana." : "Net worth stayed the same."}</>
              ) : (
                <>{locale === "fi" ? "Ota tilannekuvia nähdäksesi kehityksen." : "Take snapshots to track progress."}</>
              )}
            </p></div>
          )}

          {/* Chart with dynamic line */}
          {chartData.length > 1 && (() => {
            const lastActualIdx = chartData.reduce((last, d, i) => d.netWorth !== undefined ? i : last, -1);
            const lastActualPoint = lastActualIdx >= 0 ? chartData[lastActualIdx] : null;
            const lastNw = lastActualPoint?.netWorth ?? 0;
            const dotColor = nwColor(lastNw);
            const bubbleText = `${fmt(lastNw)} €`;
            const bubbleW = bubbleText.length * 5.8 + 14;

            /* eslint-disable @typescript-eslint/no-explicit-any */
            const renderDotLabel = (props: any) => {
              const { viewBox } = props;
              if (!viewBox) return null;
              const { x, y } = viewBox;
              const bh = 20;
              const bx = x + 8;
              const by = y - bh - 5;
              return (
                <g>
                  <path d={`M${bx + 2},${by + bh - 2} L${bx + 9},${by + bh - 2} L${bx + 2},${by + bh + 5} Z`} fill={dotColor} />
                  <rect x={bx} y={by} width={bubbleW} height={bh} rx={5} fill={dotColor} />
                  <text x={bx + bubbleW / 2} y={by + bh / 2 + 1} textAnchor="middle" dominantBaseline="middle" fill="#0a0a10" fontSize={12} fontWeight={600} style={{ fontVariantNumeric: "tabular-nums" }}>
                    {bubbleText}
                  </text>
                </g>
              );
            };

            return (
              <div className="spending-flow">
                <div className="spending-flow-chart">
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={chartData} margin={{ top: 36, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="nwLineGrad" x1="0" y1="0" x2="1" y2="0">
                          {gradientStops.map((s, i) => (
                            <stop key={i} offset={`${Math.round(s.pos * 100)}%`} stopColor={s.color} />
                          ))}
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" hide />
                      <YAxis hide domain={[(dataMin: number) => Math.min(dataMin, 0) - 200, (dataMax: number) => Math.max(dataMax, 0) + 200]} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
                      <Tooltip
                        trigger={tooltipTrigger}
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const nw = payload.find((p) => p.dataKey === "netWorth" && p.value != null);
                          const fc = payload.find((p) => p.dataKey === "forecast" && p.value != null);
                          if (!nw && !fc) return null;
                          const val = Number(nw ? nw.value : fc!.value);
                          const isForecast = !nw;
                          return (
                            <div className="chart-tooltip">
                              <p className="chart-tooltip-label">{label}</p>
                              <p className="chart-tooltip-value" style={{ color: nwColor(val) }}>
                                {isForecast ? (locale === "fi" ? "Ennuste: " : "Forecast: ") : ""}
                                {fmt(val)} €
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Area type="monotone" dataKey="forecast" stroke={dotColor} strokeWidth={2} strokeDasharray="6 4" fill="none" dot={false} strokeOpacity={0.4} />
                      <Area type="monotone" dataKey="netWorth" stroke="url(#nwLineGrad)" strokeWidth={5} fill="none" dot={false} />
                      {lastActualPoint && (
                        <ReferenceDot
                          x={lastActualPoint.date}
                          y={lastNw}
                          r={5}
                          fill="#0a0a10"
                          stroke={dotColor}
                          strokeWidth={4}
                          label={renderDotLabel}
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {/* Stat cards */}
          {latest && (
            <div className="net-worth-grid">
              <Card className="net-worth-card">
                <div className="net-worth-card-row">
                  <div className="net-worth-card-icon" data-color={latest.net_worth >= 0 ? "positive" : "negative"}>
                    <LineChart />
                  </div>
                  <div>
                    <p className="net-worth-card-label">{t.dashboard.netWorth}</p>
                    <p className={`net-worth-card-value ${latest.net_worth >= 0 ? "text-positive" : "text-negative"}`}><F v={latest.net_worth} s=" €" /></p>
                  </div>
                </div>
              </Card>

              <Card className="net-worth-card">
                <div className="net-worth-card-row">
                  <div className="net-worth-card-icon" data-color="primary">
                    <Wallet />
                  </div>
                  <div>
                    <p className="net-worth-card-label">{t.dashboard.accounts}</p>
                    <p className="net-worth-card-value"><F v={latest.checking + latest.savings} s=" €" /></p>
                  </div>
                </div>
              </Card>

              <Card className="net-worth-card">
                <div className="net-worth-card-row">
                  <div className="net-worth-card-icon" data-color="positive">
                    <TrendingUp />
                  </div>
                  <div>
                    <p className="net-worth-card-label">{t.dashboard.investments}</p>
                    <p className="net-worth-card-value text-positive"><F v={latest.investments} s=" €" /></p>
                  </div>
                </div>
              </Card>

              <Card className="net-worth-card">
                <div className="net-worth-card-row">
                  <div className="net-worth-card-icon" data-color="negative">
                    <TrendingDown />
                  </div>
                  <div>
                    <p className="net-worth-card-label">{t.debts.title}</p>
                    <p className="net-worth-card-value text-negative"><F v={latest.debts} s=" €" /></p>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Net worth growth projection */}
          {nwProjection && nwProjection.timeline.length > 1 && (() => {
            const maxYear = new Date().getFullYear() + projectionRange;
            const rangeData = nwProjection.timeline.filter((t) => parseInt(t.year) <= maxYear);
            const rangeEnd = rangeData[rangeData.length - 1];
            const rangeStart = rangeData[0];
            return (
            <Card className="metric-card" style={{ padding: "1rem" }}>
              <div className="nw-projection-header">
                <div className="payoff-stats">
                  <div>
                    <span className="payoff-stats-label">{locale === "fi" ? `Varallisuus ${projectionRange}v` : `Net worth ${projectionRange}y`} </span>
                    <span className="payoff-stats-value" data-color={rangeEnd.netWorth >= 0 ? "positive" : "negative"}><F v={rangeEnd.netWorth} /></span>
                  </div>
                  <div>
                    <span className="payoff-stats-label">{locale === "fi" ? "Kasvu" : "Growth"} </span>
                    <span className="payoff-stats-value" data-color={(rangeEnd.netWorth - rangeStart.netWorth) >= 0 ? "positive" : "negative"}>{(rangeEnd.netWorth - rangeStart.netWorth) >= 0 ? "+" : ""}<F v={rangeEnd.netWorth - rangeStart.netWorth} /></span>
                  </div>
                </div>
                <div className="chart-range-filter nw-range-filter">
                  {[5, 10, 20].map((r) => (
                    <button key={r} type="button" className={`chart-range-btn ${projectionRange === r ? "is-active" : ""}`} onClick={() => setProjectionRange(r)}>
                      {r}{locale === "fi" ? "v" : "y"}
                    </button>
                  ))}
                </div>
              </div>
              <ChartContainer height={200}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={rangeData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="nwGrowthGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="nwBaselineGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#818cf8" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="year" tick={{ fill: "#71717a", fontSize: 12 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "#71717a", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => mask(v >= 1000000 ? `${(v / 1000000).toFixed(1)}M €` : v >= 1000 || v <= -1000 ? `${(v / 1000).toFixed(0)}k €` : `${Math.round(v)} €`)} width={55} domain={["dataMin", "dataMax"]} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
                    <Tooltip
                      trigger={tooltipTrigger}
                      content={({ active, payload, label }) =>
                        active && payload?.length ? (
                          <div className="chart-tooltip">
                            <p className="chart-tooltip-label">{label}</p>
                            <p className="chart-tooltip-value" style={{ color: "#4ade80" }}>{locale === "fi" ? "Varallisuus" : "Net worth"}: {fmt(Number(payload[0].value))} €</p>
                            <p className="chart-tooltip-value" style={{ color: "#818cf8" }}>{locale === "fi" ? "Ilman tuottoa" : "Without returns"}: {fmt(Number(payload[1].value))} €</p>
                          </div>
                        ) : null
                      }
                    />
                    <Area type="monotone" dataKey="netWorth" stroke="#4ade80" strokeWidth={2} fill="url(#nwGrowthGrad)" />
                    <Area type="monotone" dataKey="baseline" stroke="#818cf8" strokeWidth={1.5} fill="url(#nwBaselineGrad)" strokeDasharray="4 4" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            </Card>
            );
          })()}

          {chartData.length <= 1 && (
            <p className="page-subtitle">
              {snapshots.length === 0
                ? (locale === "fi" ? "Ota ensimmäinen tilannekuva aloittaaksesi varallisuuden seuranta." : "Take your first snapshot to start tracking net worth over time.")
                : (locale === "fi" ? "Jatka tilannekuvien ottamista nähdäksesi varallisuuden kehityksen." : "Keep taking snapshots to see your net worth trend.")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
