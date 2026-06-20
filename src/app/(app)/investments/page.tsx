"use client";

import { useState, useEffect, useRef } from "react";
import { useLocale } from "@/lib/locale-context";
import { useTooltipTrigger } from "@/lib/use-tooltip-trigger";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TrendingUp,
  Wallet,
  Calendar,
  Loader2,
  Save,
  Check,
  GripVertical,
  Plus,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartContainer } from "@/components/ui/chart-container";
import { F } from "@/components/ui/f";

interface InvestmentData {
  id: string;
  name: string;
  balance: number;
  invested: number;
  profit: number;
  monthlyContribution: number;
  expectedReturn: number;
  monthlyTransferred: number;
  notes: string;
  ticker: string;
  added?: number; // transient: money added this save, entered in the "Added now" field
}

interface ProgressPoint { date: string; value: number; invested: number }

interface SparkPoint { t: number; c: number }

interface TickerData {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  currency: string;
  dayChangePct: number;
  week52High: number;
  week52Low: number;
  sparkline: SparkPoint[];
  sparklineMax: SparkPoint[];
}

let tickerChartId = 0;

function TickerChart({ data, dataMax, positive, currency, fmt: fmtFn, range }: { data: SparkPoint[]; dataMax?: SparkPoint[]; positive: boolean; currency: string; fmt: (v: number) => string; range: "1W" | "6M" | "MAX" }) {
  const tooltipTrigger = useTooltipTrigger();
  const now = Date.now() / 1000;
  const cutoff = range === "1W" ? now - 7 * 86400 : range === "6M" ? now - 183 * 86400 : 0;
  const source = range === "MAX" && dataMax && dataMax.length > 1 ? dataMax : data;
  const filtered = cutoff > 0 ? source.filter((p) => p.t >= cutoff) : source;
  if (filtered.length < 2) return null;
  const uid = `tc-${++tickerChartId}`;
  const color = positive ? "#4ade80" : "#f87171";
  const chartData = filtered.map((p) => {
    const d = new Date(p.t * 1000);
    return { date: `${d.getDate()}.${d.getMonth() + 1}.${range === "MAX" ? d.getFullYear() : ""}`, price: p.c };
  });
  return (
    <ResponsiveContainer width="100%" height={100}>
      <AreaChart data={chartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.15} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide />
        <Tooltip
          trigger={tooltipTrigger}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const val = Number(payload[0].value);
            const label = String(payload[0].payload?.date || "");
            return (
              <div className="chart-tooltip">
                <p className="chart-tooltip-label">{label}</p>
                <p className="chart-tooltip-value" style={{ color, fontSize: "0.75rem" }}>{fmtFn(val)} {currency}</p>
              </div>
            );
          }}
        />
        <Area type="monotone" dataKey="price" stroke={color} strokeWidth={2} fill={`url(#${uid})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function calculateProjection(
  investments: InvestmentData[],
  years: number
): { timeline: { year: string; value: number; invested: number }[]; finalValue: number; totalInvested: number; totalReturns: number } {
  if (investments.length === 0) return { timeline: [], finalValue: 0, totalInvested: 0, totalReturns: 0 };

  const timeline: { year: string; value: number; invested: number }[] = [];
  let totalValue = investments.reduce((s, i) => s + i.balance, 0);
  let totalInvested = totalValue;
  const totalMonthly = investments.reduce((s, i) => s + i.monthlyContribution, 0);

  // Weighted average return
  const weightedReturn = totalMonthly > 0
    ? investments.reduce((s, i) => s + i.expectedReturn * i.monthlyContribution, 0) / totalMonthly
    : investments.length > 0
      ? investments.reduce((s, i) => s + i.expectedReturn, 0) / investments.length
      : 7;

  const monthlyRate = weightedReturn / 100 / 12;

  timeline.push({ year: "0", value: Math.round(totalValue), invested: Math.round(totalInvested) });

  for (let year = 1; year <= years; year++) {
    for (let month = 0; month < 12; month++) {
      totalValue = totalValue * (1 + monthlyRate) + totalMonthly;
      totalInvested += totalMonthly;
    }
    timeline.push({ year: String(year), value: Math.round(totalValue), invested: Math.round(totalInvested) });
  }

  return {
    timeline,
    finalValue: Math.round(totalValue),
    totalInvested: Math.round(totalInvested),
    totalReturns: Math.round(totalValue - totalInvested),
  };
}

export default function InvestmentsPage() {
  const { t, locale, fmt, mask } = useLocale();
  const tooltipTrigger = useTooltipTrigger();
  const [investments, setInvestments] = useState<InvestmentData[]>([]);
  const [progress, setProgress] = useState<ProgressPoint[]>([]);
  const [totalInvested, setTotalInvested] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [projectionYears, setProjectionYears] = useState(20);
  const [tickerData, setTickerData] = useState<Record<string, TickerData>>({});
  const [chartRange, setChartRange] = useState<"1W" | "6M" | "MAX">("6M");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const addFormRef = useRef<HTMLFormElement>(null);

  const applyData = (data: { investments?: InvestmentData[]; progress?: ProgressPoint[]; totalInvested?: number; totalProfit?: number }) => {
    if (data.investments) setInvestments(data.investments);
    if (Array.isArray(data.progress)) setProgress(data.progress);
    if (typeof data.totalInvested === "number") setTotalInvested(data.totalInvested);
    if (typeof data.totalProfit === "number") setTotalProfit(data.totalProfit);
  };

  const loadInvestments = () => {
    fetch("/api/investments").then((r) => r.json()).then(applyData).catch(() => {});
  };

  const handleAddInvestment = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = addFormRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    if (!name) return;
    const balance = parseFloat(String(fd.get("balance") || "0").replace(",", ".")) || 0;
    const monthly = parseFloat(String(fd.get("monthly") || "0").replace(",", ".")) || 0;
    const ret = parseFloat(String(fd.get("ret") || "0").replace(",", ".")) || 0;
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: "otherAsset", balance }),
      });
      const j = await res.json();
      if (res.ok && j.id) {
        await fetch("/api/investments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // Seed cost basis from the starting value so profit begins at zero.
          body: JSON.stringify({ ynab_account_id: j.id, monthly_contribution: monthly, expected_return: ret, init_contributed: balance }),
        });
      }
      form.reset();
      setAddOpen(false);
      loadInvestments();
    } catch (err) {
      console.error("[investments] Add error:", err);
    }
  };

  useEffect(() => {
    console.debug("[investments] Loading investment accounts");
    fetch("/api/investments")
      .then((r) => r.json())
      .then((data) => {
        if (data.investments) console.info("[investments] Loaded", data.investments.length, "investment accounts");
        applyData(data);
      })
      .catch((err) => console.error("[investments] Load error:", err))
      .finally(() => setLoading(false));
  }, []);

  // Fetch ticker data for investments with tickers
  useEffect(() => {
    const tickers = investments.filter((i) => i.ticker).map((i) => i.ticker);
    if (tickers.length === 0) return;
    const unique = [...new Set(tickers)].join(",");
    console.debug("[investments] Fetching ticker data for:", unique);
    fetch(`/api/ticker?symbols=${encodeURIComponent(unique)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.tickers) {
          console.info("[investments] Got ticker data for", Object.keys(data.tickers).length, "symbols");
          setTickerData(data.tickers);
        }
      })
      .catch((err) => console.error("[investments] Ticker fetch error:", err));
  }, [investments]);

  const saveOverride = async (inv: InvestmentData) => {
    setSaving(inv.id);
    console.info("[investments] Saving value for", inv.name, "added:", inv.added || 0);
    try {
      // One call updates the value (balance), grows the cost basis by any money added now, and records
      // a progress snapshot. No separate accounts write - investments are not regular accounts.
      await fetch("/api/investments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ynab_account_id: inv.id,
          value: inv.balance,
          added: inv.added || 0,
          monthly_contribution: inv.monthlyContribution,
          expected_return: inv.expectedReturn,
          ticker: inv.ticker,
        }),
      });
      loadInvestments(); // refresh profit and the progress chart
    } catch (err) {
      console.error("[investments] Save error:", err);
    } finally {
      setTimeout(() => setSaving(null), 1000);
    }
  };

  const handleDragStart = (idx: number) => { setDragIdx(idx); };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const reordered = [...investments];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setInvestments(reordered);
    setDragIdx(idx);
  };
  const handleDragEnd = () => {
    setDragIdx(null);
    const order = investments.map((i) => i.id);
    fetch("/api/investments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order }) }).catch(() => {});
    console.info("[investments] Saved new order");
  };

  const updateInvestment = (id: string, field: keyof InvestmentData, value: number) => {
    setInvestments((prev) => prev.map((i) => i.id === id ? { ...i, [field]: value } : i));
  };

  const totalValue = investments.reduce((s, i) => s + i.balance, 0);
  const totalMonthly = investments.reduce((s, i) => s + i.monthlyContribution, 0);
  const projection = calculateProjection(investments, projectionYears);

  if (loading) {
    return (
      <div className="page-loading">
        <Loader2 className="page-loading-spinner animate-spin" />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <div>
          <h1 className="page-heading">{t.investments.title}</h1>
          <p className="page-subtitle">{t.investments.subtitle}</p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="icon-sm" />
          {locale === "fi" ? "Lisää sijoitus" : "Add investment"}
        </Button>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "fi" ? "Uusi sijoitus" : "New investment"}</DialogTitle></DialogHeader>
          <form ref={addFormRef} onSubmit={handleAddInvestment} className="form-stack">
            <div className="form-field">
              <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
              <Input name="name" required autoComplete="off" />
            </div>
            <div className="form-grid-2">
              <div className="form-field">
                <Label>{locale === "fi" ? "Arvo (€)" : "Value (€)"}</Label>
                <Input name="balance" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Tuotto %" : "Return %"}</Label>
                <Input name="ret" type="text" inputMode="decimal" placeholder="0" autoComplete="off" />
              </div>
            </div>
            <div className="form-field">
              <Label>{locale === "fi" ? "Kk-sijoitus (€)" : "Monthly contribution (€)"}</Label>
              <Input name="monthly" type="text" inputMode="decimal" placeholder="0" autoComplete="off" />
            </div>
            <Button type="submit">{locale === "fi" ? "Lisää" : "Add"}</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Summary cards */}
      <div className="page-grid-3-sm">
        <Card className="metric-card">
          <div className="metric-card-row">
            <div className="metric-card-icon" data-color="positive">
              <TrendingUp />
            </div>
            <div>
              <p className="metric-card-label">{t.investments.totalValue}</p>
              <p className="metric-card-value"><F v={totalValue} /></p>
              <p className="metric-card-note">{investments.length} {locale === "fi" ? "sijoitusta" : "investments"}</p>
            </div>
          </div>
        </Card>
        <Card className="metric-card">
          <div className="metric-card-row">
            <div className="metric-card-icon" data-color="primary">
              <Wallet />
            </div>
            <div>
              <p className="metric-card-label">{t.investments.totalMonthly}</p>
              <p className="metric-card-value"><F v={totalMonthly} /></p>
              <p className="metric-card-note">{fmt(totalMonthly * 12)} €/{locale === "fi" ? "v" : "y"}</p>
            </div>
          </div>
        </Card>
        <Card className="metric-card">
          <div className="metric-card-row">
            <div className="metric-card-icon" data-color="chart-3">
              <Calendar />
            </div>
            <div>
              <p className="metric-card-label">{t.investments.projectedValue}</p>
              <p className="metric-card-value"><F v={projection.finalValue} /></p>
              <p className="metric-card-note">{projectionYears} {locale === "fi" ? "v" : "y"}, +{fmt(projection.totalReturns)} € {locale === "fi" ? "tuottoa" : "returns"}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Projection chart */}
      {investments.length > 0 && (
        <div className="invest-charts-grid">
        <div className="form-stack">
          <div className="payoff-header">
            <h2 className="payoff-title">{t.investments.projectedGrowth}</h2>
            <div className="form-row">
              <Label className="payoff-extra-label">{locale === "fi" ? "Ajanjakso:" : "Time horizon:"}</Label>
              <Input
                type="number"
                value={projectionYears}
                onChange={(e) => setProjectionYears(Math.max(1, Math.min(50, Number(e.target.value))))}
                className="payoff-extra-input"
              />
              <span className="payoff-extra-label">{locale === "fi" ? "vuotta" : "years"}</span>
            </div>
          </div>

          <Card className="metric-card">
            <div className="payoff-stats">
              <div>
                <span className="payoff-stats-label">{t.investments.projectedValue} </span>
                <span className="payoff-stats-value" data-color="positive"><F v={projection.finalValue} /></span>
              </div>
              <div>
                <span className="payoff-stats-label">{t.investments.invested} </span>
                <span className="payoff-stats-value"><F v={projection.totalInvested} /></span>
              </div>
              <div>
                <span className="payoff-stats-label">{t.investments.returns} </span>
                <span className="payoff-stats-value" data-color="positive"><>+<F v={projection.totalReturns} /></></span>
              </div>
            </div>
            {projection.timeline.length > 1 && (
              <ChartContainer height={250}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={projection.timeline} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="investGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="investedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#818cf8" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="year" tick={{ fill: "#71717a", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}${locale === "fi" ? "v" : "y"}`} />
                    <YAxis tick={{ fill: "#71717a", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => mask(v >= 1000000 ? `${(v / 1000000).toFixed(1)}M €` : v >= 1000 ? `${(v / 1000).toFixed(0)}k €` : `${Math.round(v)} €`)} width={55} />
                    <Tooltip
                      trigger={tooltipTrigger}
                      content={({ active, payload, label }) =>
                        active && payload?.length ? (
                          <div className="chart-tooltip">
                            <p className="chart-tooltip-label">{label} {locale === "fi" ? "vuotta" : "years"}</p>
                            <p className="chart-tooltip-value text-positive">{fmt(Number(payload[0].value))} €</p>
                            <p className="chart-tooltip-value text-foreground">{locale === "fi" ? "Sijoitettu" : "Invested"}: {fmt(Number(payload[1].value))} €</p>
                          </div>
                        ) : null
                      }
                    />
                    <Area type="monotone" dataKey="value" stroke="#4ade80" strokeWidth={2} fill="url(#investGrad)" />
                    <Area type="monotone" dataKey="invested" stroke="#818cf8" strokeWidth={1.5} fill="url(#investedGrad)" strokeDasharray="4 4" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </Card>
        </div>

        {/* Your progress: actual total value over time + profit, fed by manual value saves */}
        <div className="form-stack">
          <div className="payoff-header">
            <h2 className="payoff-title">{locale === "fi" ? "Edistyminen" : "Your progress"}</h2>
          </div>
          <Card className="metric-card">
            <div className="payoff-stats">
              <div>
                <span className="payoff-stats-label">{locale === "fi" ? "Arvo nyt" : "Value now"} </span>
                <span className="payoff-stats-value"><F v={totalValue} /></span>
              </div>
              <div>
                <span className="payoff-stats-label">{locale === "fi" ? "Sijoitettu" : "Invested"} </span>
                <span className="payoff-stats-value"><F v={totalInvested} /></span>
              </div>
              <div>
                <span className="payoff-stats-label">{locale === "fi" ? "Tuotto" : "Profit"} </span>
                <span className="payoff-stats-value" data-color={totalProfit >= 0 ? "positive" : "negative"}>
                  {totalProfit >= 0 ? "+" : ""}<F v={totalProfit} />{totalInvested > 0 ? ` (${totalProfit >= 0 ? "+" : ""}${Math.round((totalProfit / totalInvested) * 1000) / 10}%)` : ""}
                </span>
              </div>
            </div>
            {progress.length > 1 ? (
              <>
                <ChartContainer height={250}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={progress} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="progressGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => { const p = String(v).split("-"); return `${Number(p[2])}.${Number(p[1])}.`; }} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: "#71717a", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => mask(v >= 1000000 ? `${(v / 1000000).toFixed(1)}M €` : v >= 1000 ? `${(v / 1000).toFixed(0)}k €` : `${Math.round(v)} €`)} width={55} />
                      <Tooltip
                        trigger={tooltipTrigger}
                        content={({ active, payload, label }) =>
                          active && payload?.length ? (
                            <div className="chart-tooltip">
                              <p className="chart-tooltip-label">{(() => { const p = String(label).split("-"); return `${Number(p[2])}.${Number(p[1])}.${p[0]}`; })()}</p>
                              <p className="chart-tooltip-value text-positive">{fmt(Number(payload[0].value))} €</p>
                              <p className="chart-tooltip-value text-foreground">{locale === "fi" ? "Sijoitettu" : "Invested"}: {fmt(Number(payload[1]?.value ?? 0))} €</p>
                            </div>
                          ) : null
                        }
                      />
                      <Area type="monotone" dataKey="value" stroke="#4ade80" strokeWidth={2} fill="url(#progressGrad)" />
                      <Area type="monotone" dataKey="invested" stroke="#818cf8" strokeWidth={1.5} fill="none" strokeDasharray="4 4" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <p className="investment-progress-hint">{locale === "fi" ? "Voit päivittää edistymistä tallentamalla arvon." : "You can update progress by saving a value."}</p>
              </>
            ) : (
              <p className="investment-progress-hint">{locale === "fi" ? "Tallenna sijoituksen arvo aloittaaksesi edistymisen seurannan." : "Save an investment value to start tracking your progress."}</p>
            )}
          </Card>
        </div>
        </div>
      )}

      {/* Range filter + Investment accounts list */}
      {investments.length > 0 && (
        <>
          <div className="chart-range-filter">
            {(["1W", "6M", "MAX"] as const).map((r) => (
              <button key={r} type="button" className={`chart-range-btn ${chartRange === r ? "is-active" : ""}`} onClick={() => setChartRange(r)}>
                {r}
              </button>
            ))}
          </div>
          <Card className="list-card">
            {investments.map((inv, idx) => (
            <div key={inv.id} className="edit-item" draggable onDragStart={() => handleDragStart(idx)} onDragOver={(e) => handleDragOver(e, idx)} onDragEnd={handleDragEnd}>
              <div className="edit-item-header">
                <div>
                  <p className="edit-item-name">{inv.name}</p>
                  {inv.monthlyTransferred > 0 && (
                    <p className="edit-item-meta">
                      {locale === "fi" ? "Siirretty tässä kuussa" : "Transferred this month"}: <F v={inv.monthlyTransferred} />
                    </p>
                  )}
                </div>
                <div className="edit-item-right">
                  <p className="edit-item-amount text-positive"><F v={inv.balance} /></p>
                </div>
                <GripVertical className="drag-handle" />
              </div>
              {inv.ticker && tickerData[inv.ticker.toUpperCase()] && (() => {
                const td = tickerData[inv.ticker.toUpperCase()];
                const isIndex = inv.ticker.startsWith("^") || inv.ticker.toUpperCase().startsWith("SELIGSON:");
                return (
                  <div className="investment-ticker-info">
                    <p className="edit-item-meta">
                      {isIndex ? `${locale === "fi" ? "Indeksi" : "Index"}: ` : ""}{td.name}: {td.price.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {td.currency}
                      {" "}
                      <span className={td.dayChangePct >= 0 ? "text-positive" : "text-negative"}>
                        {td.dayChangePct >= 0 ? "+" : ""}{td.dayChangePct}% {locale === "fi" ? "tänään" : "today"}
                      </span>
                    </p>
                    <TickerChart data={td.sparkline || []} dataMax={td.sparklineMax} positive={td.dayChangePct >= 0} currency={td.currency} fmt={fmt} range={chartRange} />
                  </div>
                );
              })()}
              <div className="list-edit-row">
                <div className="list-edit-field">
                  <Label className="list-edit-label">{locale === "fi" ? "Arvo €" : "Value €"}</Label>
                  <Input
                    type="number"
                    step="1"
                    value={inv.balance || ""}
                    onChange={(e) => updateInvestment(inv.id, "balance", parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="list-edit-input"
                  />
                </div>
                <div className="list-edit-field">
                  <Label className="list-edit-label">{locale === "fi" ? "Lisätty nyt €" : "Added now €"}</Label>
                  <Input
                    type="number"
                    step="1"
                    value={inv.added || ""}
                    onChange={(e) => updateInvestment(inv.id, "added", parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="list-edit-input"
                  />
                </div>
                <div className="list-edit-field">
                  <Label className="list-edit-label">{locale === "fi" ? "Kk-sijoitus €" : "Monthly €"}</Label>
                  <Input
                    type="number"
                    step="1"
                    value={inv.monthlyContribution || ""}
                    onChange={(e) => updateInvestment(inv.id, "monthlyContribution", parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="list-edit-input"
                  />
                </div>
                <div className="list-edit-field">
                  <Label className="list-edit-label">{locale === "fi" ? "Tuotto %" : "Return %"}</Label>
                  {(() => {
                    const td = inv.ticker ? tickerData[inv.ticker.toUpperCase()] : null;
                    if (td && td.sparkline && td.sparkline.length >= 2) {
                      const first = td.sparkline[0].c;
                      const last = td.sparkline[td.sparkline.length - 1].c;
                      const yearReturn = first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : 0;
                      return (
                        <Input
                          type="text"
                          value={`${yearReturn > 0 ? "+" : ""}${yearReturn}%`}
                          readOnly
                          className="list-edit-input"
                        />
                      );
                    }
                    return (
                      <Input
                        type="number"
                        step="0.1"
                        value={inv.expectedReturn || ""}
                        onChange={(e) => updateInvestment(inv.id, "expectedReturn", parseFloat(e.target.value) || 0)}
                        placeholder="7"
                        className="list-edit-input"
                      />
                    );
                  })()}
                </div>
                <div className="list-edit-field">
                  <Label className="list-edit-label">Ticker</Label>
                  <Input
                    type="text"
                    value={inv.ticker || ""}
                    onChange={(e) => setInvestments((prev) => prev.map((i) => i.id === inv.id ? { ...i, ticker: e.target.value } : i))}
                    placeholder="NVDA"
                    className="list-edit-input"
                    list={`ticker-suggest-${inv.id}`}
                  />
                  <datalist id={`ticker-suggest-${inv.id}`}>
                    <option value="^OMXH25" label="OMX Helsinki 25" />
                    <option value="^GSPC" label="S&P 500" />
                    <option value="^STOXX50E" label="Euro Stoxx 50" />
                    <option value="BTC-USD" label="Bitcoin" />
                    <option value="ETH-USD" label="Ethereum" />
                    <option value="NVDA" label="NVIDIA" />
                    <option value="AAPL" label="Apple" />
                    <option value="MSFT" label="Microsoft" />
                    <option value="TSLA" label="Tesla" />
                    <option value="AMZN" label="Amazon" />
                    <option value="VWCE.DE" label="Vanguard FTSE All-World (Revolut proxy)" />
                    <option value="SELIGSON:brands" label="Seligson Global Top 25 Brands" />
                    <option value="SELIGSON:suomi" label="Seligson Finland Index" />
                    <option value="SELIGSON:phoebus" label="Seligson Phoebus" />
                  </datalist>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => saveOverride(inv)}
                >
                  {saving === inv.id ? <Check /> : <Save />}
                </Button>
              </div>
            </div>
          ))}
        </Card>
        </>
      )}
    </div>
  );
}
