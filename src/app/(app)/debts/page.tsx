"use client";

import { useState, useEffect } from "react";
import { useLocale } from "@/lib/locale-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingDown,
  Target,
  Calendar,
  Flame,
  Loader2,
  Sparkles,
  AlertCircle,
  RefreshCw,
  Save,
  Check,
  GripVertical,
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
import { formatDuration } from "@/lib/date-utils";
import { F } from "@/components/ui/f";

interface DebtData {
  id: string;
  name: string;
  balance: number;
  interestRate: number;
  minimumPayment: number;
  dueDay: number;
  monthlyTarget: number;
  monthlyPayment: number;
  notes: string;
  isPriority: number;
}

function calculatePayoff(debts: DebtData[], extraPayment: number, sortFn: (a: DebtData, b: DebtData) => number) {
  if (debts.length === 0) return { timeline: [], months: 0, totalInterest: 0 };
  const sorted = [...debts].sort(sortFn);
  const balances = sorted.map((d) => d.balance);
  const rates = sorted.map((d) => d.interestRate / 100 / 12);
  const minPayments = sorted.map((d) => d.minimumPayment || d.monthlyTarget || 50);
  const timeline: { month: string; total: number }[] = [];
  let month = 0;
  let totalInterest = 0;

  while (balances.some((b) => b > 0) && month < 120) {
    let extra = extraPayment;
    for (let i = 0; i < balances.length; i++) {
      if (balances[i] <= 0) {
        extra += minPayments[i];
        continue;
      }
      const interest = balances[i] * rates[i];
      totalInterest += interest;
      let payment = minPayments[i] + (i === balances.findIndex((b) => b > 0) ? extra : 0);
      payment = Math.min(payment, balances[i] + interest);
      balances[i] = balances[i] + interest - payment;
      if (balances[i] < 1) balances[i] = 0;
    }
    const date = new Date();
    date.setMonth(date.getMonth() + month);
    timeline.push({
      month: date.toLocaleDateString("en", { month: "short", year: "2-digit" }),
      total: Math.round(balances.reduce((s, b) => s + b, 0)),
    });
    month++;
  }
  return { timeline, months: month, totalInterest: Math.round(totalInterest) };
}

export default function DebtsPage() {
  const { t, locale, fmt, mask } = useLocale();
  const [debts, setDebts] = useState<DebtData[]>([]);
  const [loading, setLoading] = useState(true);
  const [extraPayment, setExtraPayment] = useState(50);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHidden, setAiHidden] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    console.debug("[debts] Loading debts");
    fetch("/api/debts")
      .then((r) => r.json())
      .then((data) => {
        if (data.debts) {
          console.info("[debts] Loaded", data.debts.length, "debts");
          setDebts(data.debts);
        }
      })
      .catch((err) => console.error("[debts] Load error:", err))
      .finally(() => setLoading(false));

    // Honor household AI-summaries off-switch and load cached suggestion if not disabled
    fetch("/api/household")
      .then((r) => r.json())
      .then((h) => {
        if (h.settings?.ai_summaries_disabled === "1") {
          setAiHidden(true);
          return;
        }
        return fetch("/api/debts/suggestion?cache_only=1")
          .then((r) => r.json())
          .then((data) => {
            if (data.disabled) { setAiHidden(true); return; }
            if (data.suggestion) {
              console.info("[debts] Loaded cached AI suggestion");
              setAiSuggestion(data.suggestion);
            }
          });
      })
      .catch(() => {});
  }, []);

  const fetchAiSuggestion = () => {
    setAiLoading(true);
    setAiSuggestion(null);
    console.info("[debts] Fetching AI suggestion");
    fetch("/api/debts/suggestion?refresh=1")
      .then((r) => r.json())
      .then((data) => {
        if (data.suggestion) setAiSuggestion(data.suggestion);
      })
      .catch((err) => console.error("[debts] AI suggestion error:", err))
      .finally(() => setAiLoading(false));
  };

  const saveOverride = async (debt: DebtData) => {
    setSaving(debt.id);
    console.info("[debts] Saving override for", debt.name);
    try {
      await fetch("/api/debts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ynab_account_id: debt.id,
          interest_rate: debt.interestRate,
          minimum_payment: debt.minimumPayment,
          due_day: debt.dueDay,
        }),
      });
    } catch (err) {
      console.error("[debts] Save error:", err);
    } finally {
      setTimeout(() => setSaving(null), 1000);
    }
  };

  const handleDragStart = (idx: number) => { setDragIdx(idx); };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const reordered = [...debts];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setDebts(reordered);
    setDragIdx(idx);
  };
  const handleDragEnd = () => {
    setDragIdx(null);
    const order = debts.map((d) => d.id);
    fetch("/api/debts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order }) }).catch(() => {});
    console.info("[debts] Saved new order");
  };

  const updateDebt = (id: string, field: keyof DebtData, value: number) => {
    setDebts((prev) => prev.map((d) => d.id === id ? { ...d, [field]: value } : d));
  };

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
  const totalMonthly = debts.reduce((s, d) => s + (d.monthlyPayment || d.minimumPayment || d.monthlyTarget), 0);

  const snowball = calculatePayoff(debts, extraPayment, (a, b) => a.balance - b.balance);
  const avalanche = calculatePayoff(debts, extraPayment, (a, b) => b.interestRate - a.interestRate);

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
          <h1 className="page-heading">{t.debts.title}</h1>
          <p className="page-subtitle">{t.debts.subtitle}</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="page-grid-3-sm">
        <Card className="metric-card">
          <div className="metric-card-row">
            <div className="metric-card-icon" data-color="negative">
              <TrendingDown />
            </div>
            <div>
              <p className="metric-card-label">{t.debts.totalDebt}</p>
              <p className="metric-card-value"><F v={totalDebt} /></p>
            </div>
          </div>
        </Card>
        <Card className="metric-card">
          <div className="metric-card-row">
            <div className="metric-card-icon" data-color="primary">
              <Target />
            </div>
            <div>
              <p className="metric-card-label">{locale === "fi" ? "Kuukausimaksut" : "Monthly payments"}</p>
              <p className="metric-card-value"><F v={totalMonthly} /></p>
            </div>
          </div>
        </Card>
        <Card className="metric-card">
          <div className="metric-card-row">
            <div className="metric-card-icon" data-color="chart-3">
              <Calendar />
            </div>
            <div>
              <p className="metric-card-label">{t.debts.debtFreeIn}</p>
              <p className="metric-card-value">{formatDuration(snowball.months, locale)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* AI suggestion */}
      {!aiHidden && (
      <Card className="ai-summary-card">
        <div className="ai-summary-header">
          <div className="ai-summary-icon"><Sparkles /></div>
          <div className="ai-summary-actions">
            <button type="button" className="ai-summary-refresh" onClick={fetchAiSuggestion} disabled={aiLoading}>
              <RefreshCw className={aiLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        {aiLoading ? (
          <div className="typing-dots"><span /><span /><span /></div>
        ) : aiSuggestion ? (
          <p className="ai-summary-text">{aiSuggestion}</p>
        ) : (
          <p className="ai-summary-text page-subtitle">
            {locale === "fi" ? "Hae AI-suositus velkojesi maksustrategiasta." : "Get AI suggestion for your debt payoff strategy."}
          </p>
        )}
      </Card>
      )}

      {/* Debt list with editable fields */}
      {debts.length > 0 && (
        <Card className="list-card">
          {debts.map((debt, idx) => (
            <div key={debt.id} className="edit-item" draggable onDragStart={() => handleDragStart(idx)} onDragOver={(e) => handleDragOver(e, idx)} onDragEnd={handleDragEnd}>
              <div className="edit-item-header">
                <div>
                  <div className="list-item-name-row">
                    <p className="edit-item-name">{debt.name}</p>
                    <button type="button" className={`priority-toggle ${debt.isPriority ? "is-priority" : ""}`} onClick={async (e) => { e.stopPropagation(); await fetch("/api/debts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ynab_account_id: debt.id, is_priority: debt.isPriority ? 0 : 1 }) }); setDebts((prev) => prev.map((d) => d.id === debt.id ? { ...d, isPriority: debt.isPriority ? 0 : 1 } : d)); }} title={locale === "fi" ? (debt.isPriority ? "Pakollinen" : "Merkitse pakolliseksi") : (debt.isPriority ? "Must-pay" : "Mark as must-pay")}>
                      <AlertCircle />
                    </button>
                  </div>
                  {debt.monthlyPayment > 0 && (
                    <p className="edit-item-meta">
                      {locale === "fi" ? "Maksettu tässä kuussa" : "Paid this month"}: <F v={debt.monthlyPayment} />
                    </p>
                  )}
                </div>
                <div className="edit-item-right">
                  <p className="edit-item-amount"><F v={debt.balance} /></p>
                </div>
                <GripVertical className="drag-handle" />
              </div>
              <div className="list-edit-row">
                <div className="list-edit-field">
                  <Label className="list-edit-label">{locale === "fi" ? "Korko %" : "Interest %"}</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={debt.interestRate || ""}
                    onChange={(e) => updateDebt(debt.id, "interestRate", parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="list-edit-input"
                  />
                </div>
                <div className="list-edit-field">
                  <Label className="list-edit-label">{locale === "fi" ? "Kk-maksu €" : "Monthly €"}</Label>
                  <Input
                    type="number"
                    step="1"
                    value={debt.minimumPayment || ""}
                    onChange={(e) => updateDebt(debt.id, "minimumPayment", parseFloat(e.target.value) || 0)}
                    placeholder={debt.monthlyTarget ? String(debt.monthlyTarget) : "0"}
                    className="list-edit-input"
                  />
                </div>
                <div className="list-edit-field">
                  <Label className="list-edit-label">{locale === "fi" ? "Eräpv" : "Due day"}</Label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    max="31"
                    value={debt.dueDay || ""}
                    onChange={(e) => updateDebt(debt.id, "dueDay", parseInt(e.target.value) || 0)}
                    placeholder="0"
                    className="list-edit-input"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => saveOverride(debt)}
                  disabled={!debt.dueDay || debt.dueDay < 1}
                >
                  {saving === debt.id ? <Check /> : <Save />}
                </Button>
              </div>
              <Button
                type="button"
                variant={debt.isPriority ? "destructive" : "outline"}
                size="sm"
                onClick={async () => { await fetch("/api/debts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ynab_account_id: debt.id, is_priority: debt.isPriority ? 0 : 1 }) }); setDebts((prev) => prev.map((d) => d.id === debt.id ? { ...d, isPriority: debt.isPriority ? 0 : 1 } : d)); }}
              >
                {debt.isPriority
                  ? (locale === "fi" ? "Pakollinen velka" : "Must-pay debt")
                  : (locale === "fi" ? "Merkitse pakolliseksi" : "Mark as must-pay")}
              </Button>
            </div>
          ))}
        </Card>
      )}

      {/* Payoff strategy */}
      {debts.length > 0 && (
        <div className="form-stack">
          <div className="payoff-header">
            <h2 className="payoff-title">{t.debts.payoffStrategy}</h2>
            <div className="form-row">
              <Label className="payoff-extra-label">{t.debts.extraMonthly}</Label>
              <Input
                type="number"
                value={extraPayment}
                onChange={(e) => setExtraPayment(Number(e.target.value))}
                className="payoff-extra-input"
              />
            </div>
          </div>

          <Tabs defaultValue="snowball">
            <TabsList>
              <TabsTrigger value="snowball">
                <Flame className="tabs-trigger-icon" />
                {t.debts.snowball}
              </TabsTrigger>
              <TabsTrigger value="avalanche">
                <TrendingDown className="tabs-trigger-icon" />
                {t.debts.avalanche}
              </TabsTrigger>
            </TabsList>

            {[
              { key: "snowball", data: snowball, desc: t.debts.snowballDesc },
              { key: "avalanche", data: avalanche, desc: t.debts.avalancheDesc },
            ].map(({ key, data, desc }) => (
              <TabsContent key={key} value={key}>
                <Card className="metric-card">
                  <p className="payoff-desc">{desc}</p>
                  <div className="payoff-stats">
                    <div>
                      <span className="payoff-stats-label">{t.debts.debtFree} </span>
                      <span className="payoff-stats-value">{formatDuration(data.months, locale)}</span>
                    </div>
                    <div>
                      <span className="payoff-stats-label">{t.debts.totalInterest} </span>
                      <span className="payoff-stats-value" data-color="negative"><F v={data.totalInterest} /></span>
                    </div>
                  </div>
                  {data.timeline.length > 1 && (
                    <ChartContainer height={250}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data.timeline} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id={`${key}Grad`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#f87171" stopOpacity={0.3} />
                              <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                          <XAxis dataKey="month" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                          <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => mask(v >= 1000 ? `${(v/1000).toFixed(0)}k €` : `${Math.round(v)} €`)} width={50} />
                          <Tooltip
                            content={({ active, payload, label }) =>
                              active && payload?.length ? (
                                <div className="chart-tooltip">
                                  <p className="chart-tooltip-label">{label}</p>
                                  <p className="chart-tooltip-value text-foreground">{fmt(Number(payload[0].value))} €</p>
                                </div>
                              ) : null
                            }
                          />
                          <Area type="monotone" dataKey="total" stroke="#f87171" strokeWidth={2} fill={`url(#${key}Grad)`} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  )}
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      )}
    </div>
  );
}

