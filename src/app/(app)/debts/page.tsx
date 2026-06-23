"use client";

import { useState, useEffect, useRef } from "react";
import { useLocale } from "@/lib/locale-context";
import { useTooltipTrigger } from "@/lib/use-tooltip-trigger";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatDuration } from "@/lib/date-utils";
import { F } from "@/components/ui/f";
import { DebtDonut } from "@/components/debts/debt-donut";

interface DebtData {
  id: string;
  name: string;
  balance: number;
  interestRate: number;
  minimumPayment: number;
  dueDay: number;
  monthlyTarget: number;
  monthlyPayment: number;
  originalAmount: number;
  suggestedOriginal: number;
  paidTotal: number;
  percentPaid: number;
  notes: string;
  isPriority: number;
  history?: { month: string; balance: number }[];
}

// Compact actual-balance history sparkline for one debt.
function DebtSparkline({ data, uid }: { data: { month: string; balance: number }[]; uid: string }) {
  const { fmt } = useLocale();
  const tooltipTrigger = useTooltipTrigger();
  return (
    <div className="debt-spark">
      <ResponsiveContainer width="100%" height={56}>
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`debt-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f87171" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            trigger={tooltipTrigger}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="chart-tooltip">
                  <p className="chart-tooltip-label">{String(label)}</p>
                  <p className="chart-tooltip-value text-foreground">{fmt(Number(payload[0].value))} €</p>
                </div>
              ) : null
            }
          />
          <Area type="monotone" dataKey="balance" stroke="#f87171" strokeWidth={1.5} fill={`url(#debt-${uid})`} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
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
  const tooltipTrigger = useTooltipTrigger();
  const [debts, setDebts] = useState<DebtData[]>([]);
  const [loading, setLoading] = useState(true);
  const [extraPayment, setExtraPayment] = useState(50);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHidden, setAiHidden] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const addFormRef = useRef<HTMLFormElement>(null);

  const loadDebts = () => {
    fetch("/api/debts").then((r) => r.json()).then((data) => { if (data.debts) setDebts(data.debts); }).catch(() => {});
  };

  const handleAddDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = addFormRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    if (!name) return;
    const balance = Math.abs(parseFloat(String(fd.get("balance") || "0").replace(",", ".")) || 0);
    const interest = parseFloat(String(fd.get("interest") || "0").replace(",", ".")) || 0;
    const payment = parseFloat(String(fd.get("payment") || "0").replace(",", ".")) || 0;
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: "otherDebt", balance: -balance }),
      });
      const j = await res.json();
      if (res.ok && j.id && (interest || payment)) {
        await fetch("/api/debts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ynab_account_id: j.id, interest_rate: interest, minimum_payment: payment }),
        });
      }
      form.reset();
      setAddOpen(false);
      loadDebts();
    } catch (err) {
      console.error("[debts] Add error:", err);
    }
  };

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
      // Persist the owed balance on the account (stored negative) and the debt override
      await fetch("/api/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: debt.id, balance: -Math.abs(debt.balance) }),
      });
      await fetch("/api/debts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ynab_account_id: debt.id,
          interest_rate: debt.interestRate,
          minimum_payment: debt.minimumPayment,
          due_day: debt.dueDay,
          original_amount: debt.originalAmount,
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
  const totalMonthly = debts.reduce((s, d) => s + (d.minimumPayment || d.monthlyTarget), 0);

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
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="icon-sm" />
          {locale === "fi" ? "Lisää velka" : "Add debt"}
        </Button>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "fi" ? "Uusi velka" : "New debt"}</DialogTitle></DialogHeader>
          <form ref={addFormRef} onSubmit={handleAddDebt} className="form-stack">
            <div className="form-field">
              <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
              <Input name="name" required autoComplete="off" />
            </div>
            <div className="form-grid-2">
              <div className="form-field">
                <Label>{locale === "fi" ? "Velkaa (€)" : "Amount owed (€)"}</Label>
                <Input name="balance" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Korko %" : "Interest %"}</Label>
                <Input name="interest" type="text" inputMode="decimal" placeholder="0" autoComplete="off" />
              </div>
            </div>
            <div className="form-field">
              <Label>{locale === "fi" ? "Kuukausimaksu (€)" : "Monthly payment (€)"}</Label>
              <Input name="payment" type="text" inputMode="decimal" placeholder="0" autoComplete="off" />
            </div>
            <Button type="submit">{locale === "fi" ? "Lisää" : "Add"}</Button>
          </form>
        </DialogContent>
      </Dialog>

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

      {/* Debt breakdown donut */}
      {debts.length > 0 && (
        <DebtDonut
          debts={debts.map((d) => ({
            id: d.id,
            name: d.name,
            balance: d.balance,
            paidThisMonth: d.monthlyPayment || 0,
            paidTotal: d.paidTotal || 0,
            percentPaid: d.percentPaid || 0,
            effectiveOriginal: d.originalAmount > 0 ? d.originalAmount : d.suggestedOriginal,
          }))}
        />
      )}

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
        <Card className="list-card debt-edit-grid">
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
              {debt.percentPaid > 0 && (
                <div className="debt-progress-row">
                  <Progress value={debt.percentPaid} className="debt-progress" />
                  <span className="debt-progress-label">
                    {mask(`${debt.percentPaid} %`)} {locale === "fi" ? "maksettu" : "paid"} · {locale === "fi" ? "alkup." : "orig."} <F v={debt.originalAmount > 0 ? debt.originalAmount : debt.suggestedOriginal} />
                  </span>
                </div>
              )}
              {debt.history && debt.history.length > 1 && (
                <DebtSparkline data={debt.history} uid={debt.id.replace(/[^a-zA-Z0-9]/g, "")} />
              )}
              <div className="list-edit-row">
                <div className="list-edit-field">
                  <Label className="list-edit-label">{locale === "fi" ? "Alkup. €" : "Original €"}</Label>
                  <Input
                    type="number"
                    step="1"
                    value={debt.originalAmount || ""}
                    onChange={(e) => updateDebt(debt.id, "originalAmount", parseFloat(e.target.value) || 0)}
                    placeholder={debt.suggestedOriginal ? String(Math.round(debt.suggestedOriginal)) : "0"}
                    className="list-edit-input"
                  />
                </div>
                <div className="list-edit-field">
                  <Label className="list-edit-label">{locale === "fi" ? "Saldo €" : "Balance €"}</Label>
                  <Input
                    type="number"
                    step="1"
                    value={debt.balance || ""}
                    onChange={(e) => updateDebt(debt.id, "balance", parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="list-edit-input"
                  />
                </div>
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
                >
                  {saving === debt.id ? <Check /> : <Save />}
                </Button>
              </div>
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
                          <XAxis dataKey="month" tick={{ fill: "#71717a", fontSize: 12 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                          <YAxis tick={{ fill: "#71717a", fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v) => mask(v >= 1000 ? `${(v/1000).toFixed(0)}k €` : `${Math.round(v)} €`)} width={50} />
                          <Tooltip
                            trigger={tooltipTrigger}
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

