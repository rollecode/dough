"use client";

import { useState, useEffect, useRef } from "react";
import { useLocale } from "@/lib/locale-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Loader2, Check, X } from "lucide-react";
import { F } from "@/components/ui/f";

interface Income {
  id: number;
  name: string;
  amount: number;
  expected_day: number;
  is_recurring: number;
  is_active: number;
  average_amount: number | null;
  history_count: number;
  target_account_id: string;
}

interface AccountOption {
  id: string;
  name: string;
}

export default function IncomePage() {
  const { t, locale } = useLocale();
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Income | null>(null);
  const [monthlyMatches, setMonthlyMatches] = useState<Record<number, boolean>>({});
  const [patterns, setPatterns] = useState<Record<number, { id: number; payee_pattern: string }[]>>({});
  const [newPattern, setNewPattern] = useState("");
  const [patternMinAmount, setPatternMinAmount] = useState("");
  const [patternMaxAmount, setPatternMaxAmount] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [editTargetAccount, setEditTargetAccount] = useState<string>("");
  const addFormRef = useRef<HTMLFormElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    console.debug("[income] Loading income sources and matches");
    Promise.all([
      fetch("/api/income").then((r) => r.json()),
      fetch("/api/matches").then((r) => r.json()),
      fetch("/api/ynab/accounts").then((r) => r.json()),
    ])
      .then(([incomeData, matchData, accountsData]) => {
        if (incomeData.incomes) setIncomes(incomeData.incomes);
        if (accountsData.accounts) {
          setAccounts(accountsData.accounts.filter((a: { type: string; closed: number }) => (a.type === "checking" || a.type === "savings") && !a.closed).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })));
        }
        if (matchData.patterns) {
          const grouped: Record<number, { id: number; payee_pattern: string }[]> = {};
          for (const p of matchData.patterns) {
            if (p.source_type === "income") {
              if (!grouped[p.source_id]) grouped[p.source_id] = [];
              grouped[p.source_id].push({ id: p.id, payee_pattern: p.payee_pattern });
            }
          }
          setPatterns(grouped);
        }
        if (matchData.monthlyMatches) {
          const matched: Record<number, boolean> = {};
          for (const m of matchData.monthlyMatches) {
            if (m.source_type === "income") matched[m.source_id] = true;
          }
          setMonthlyMatches(matched);
        }
      })
      .catch((err) => console.error("[income] Load error:", err))
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = addFormRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const body = {
      name: fd.get("name") as string,
      amount: parseFloat((fd.get("amount") as string).replace(",", ".")),
      expected_day: parseInt(fd.get("expected_day") as string, 10),
      is_recurring: true,
    };
    console.info("[income] Adding:", body.name);
    try {
      const res = await fetch("/api/income", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.id) {
        setIncomes((prev) => [...prev, { id: data.id, ...body, is_recurring: 1, is_active: 1, average_amount: null, history_count: 0, target_account_id: "" }]);
        setAddOpen(false);
        form.reset();
      }
    } catch (err) { console.error("[income] Add error:", err); }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editFormRef.current) return;
    const fd = new FormData(editFormRef.current);
    const body = {
      id: editTarget.id,
      name: fd.get("name") as string,
      amount: parseFloat((fd.get("amount") as string).replace(",", ".")),
      expected_day: parseInt(fd.get("expected_day") as string, 10),
      target_account_id: editTargetAccount,
    };
    console.info("[income] Editing:", body.id);
    try {
      await fetch("/api/income", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setIncomes((prev) => prev.map((i) => i.id === body.id ? { ...i, name: body.name, amount: body.amount, expected_day: body.expected_day, target_account_id: body.target_account_id } : i));
      setEditOpen(false);
      setEditTarget(null);
    } catch (err) { console.error("[income] Edit error:", err); }
  };

  const toggleIncome = async (id: number, currentActive: number) => {
    const newActive = currentActive ? 0 : 1;
    setIncomes((prev) => prev.map((i) => i.id === id ? { ...i, is_active: newActive } : i));
    try {
      await fetch("/api/income", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, is_active: newActive }) });
    } catch (err) { console.error("[income] Toggle error:", err); }
  };

  const markReceived = async (id: number, received: boolean) => {
    setMonthlyMatches((prev) => ({ ...prev, [id]: received }));
    console.info("[income] Marking", id, received ? "received" : "not received");
    try {
      await fetch("/api/income", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, mark_received: received }) });
    } catch (err) { console.error("[income] Mark received error:", err); }
  };

  const addPattern = async (incomeId: number) => {
    if (!newPattern.trim()) return;
    console.info("[income] Adding pattern:", newPattern, "for income", incomeId);
    try {
      await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: "income",
          source_id: incomeId,
          payee_pattern: newPattern.trim(),
          min_amount: parseFloat(patternMinAmount) || 0,
          max_amount: parseFloat(patternMaxAmount) || 0,
        }),
      });
      setNewPattern("");
      setPatternMinAmount("");
      setPatternMaxAmount("");
      // Reload patterns
      const matchData = await fetch("/api/matches").then((r) => r.json());
      if (matchData.patterns) {
        const grouped: Record<number, { id: number; payee_pattern: string }[]> = {};
        for (const p of matchData.patterns) {
          if (p.source_type === "income") {
            if (!grouped[p.source_id]) grouped[p.source_id] = [];
            grouped[p.source_id].push({ id: p.id, payee_pattern: p.payee_pattern });
          }
        }
        setPatterns(grouped);
      }
    } catch (err) { console.error("[income] Add pattern error:", err); }
  };

  const deletePattern = async (patternId: number) => {
    try {
      await fetch("/api/matches", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: patternId }),
      });
      const matchData = await fetch("/api/matches").then((r) => r.json());
      if (matchData.patterns) {
        const grouped: Record<number, { id: number; payee_pattern: string }[]> = {};
        for (const p of matchData.patterns) {
          if (p.source_type === "income") {
            if (!grouped[p.source_id]) grouped[p.source_id] = [];
            grouped[p.source_id].push({ id: p.id, payee_pattern: p.payee_pattern });
          }
        }
        setPatterns(grouped);
      }
    } catch (err) { console.error("[income] Delete pattern error:", err); }
  };

  const deleteIncome = async (id: number) => {
    console.info("[income] Deleting:", id);
    try {
      await fetch("/api/income", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      setIncomes((prev) => prev.filter((i) => i.id !== id));
    } catch (err) { console.error("[income] Delete error:", err); }
  };

  const formatDay = (day: number) => day === 0 ? (locale === "fi" ? "kuun viimeinen" : "last day") : `${day}.`;

  const active = incomes.filter((i) => i.is_active);
  const monthlyTotal = active.reduce((s, i) => s + i.amount, 0);

  if (loading) {
    return <div className="page-loading"><Loader2 className="page-loading-spinner animate-spin" /></div>;
  }

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <div>
          <h1 className="page-heading">{t.income.title}</h1>
          <p className="page-subtitle">{t.income.subtitle}</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="icon-sm" />
            {t.income.addIncome}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t.income.addIncomeSource}</DialogTitle></DialogHeader>
            <form ref={addFormRef} onSubmit={handleAdd} className="form-stack">
              <div className="form-field">
                <Label>{t.income.name}</Label>
                <Input name="name" placeholder={t.income.namePlaceholder} required />
              </div>
              <div className="form-grid-2">
                <div className="form-field">
                  <Label>{t.income.amountEur}</Label>
                  <Input name="amount" type="text" inputMode="decimal" placeholder="0.00" required />
                </div>
                <div className="form-field">
                  <Label>{t.income.expectedDay}</Label>
                  <Input name="expected_day" type="number" min="0" max="31" placeholder="0 = viimeinen" required />
                </div>
              </div>
              <Button type="submit">{t.income.addIncome}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="metric-card">
        <p className="metric-card-label">{t.income.expectedMonthly}</p>
        <p className="metric-card-value-3xl text-positive"><F v={monthlyTotal} /></p>
        <p className="metric-card-note metric-card-note-mt">{active.length} {t.common.sources}</p>
      </Card>

      {incomes.length > 0 && (
        <Card className="list-card list-card-divider">
          {[...incomes].sort((a, b) => a.expected_day - b.expected_day).map((income) => (
            <div
              key={income.id}
              className="list-item"
              onClick={() => { setEditTarget(income); setEditTargetAccount(income.target_account_id || ""); setEditOpen(true); }}
            >
              <div className="list-item-body">
                <div className="list-item-name-row">
                  <p className={`list-item-name ${!income.is_active ? "is-inactive" : ""}`}>{income.name}</p>
                  <span onClick={(e) => e.stopPropagation()}>
                    {monthlyMatches[income.id] ? (
                      <button type="button" className="badge-toggle" onClick={() => markReceived(income.id, false)} title={locale === "fi" ? "Merkitse ei-saaduksi" : "Mark not received"}>
                        <Badge className="badge-matched"><Check className="icon-xs" />{locale === "fi" ? "Saatu" : "Received"}</Badge>
                      </button>
                    ) : (
                      <button type="button" className="badge-toggle badge-toggle-muted" onClick={() => markReceived(income.id, true)} title={locale === "fi" ? "Merkitse saaduksi" : "Mark received"}>
                        {locale === "fi" ? "Ei saatu" : "Not received"}
                      </button>
                    )}
                  </span>
                </div>
                <p className="list-item-meta">
                  {t.income.expectedAround} {formatDay(income.expected_day)}
                  {(patterns[income.id] || []).length > 0 && (
                    <span className="list-item-patterns"> – {patterns[income.id].map((p) => p.payee_pattern).join(", ")}</span>
                  )}
                </p>
              </div>
              <div className="list-item-end">
                <p className="list-item-amount-value" data-positive><>+<F v={income.amount} /></></p>
                {income.average_amount && income.history_count >= 2 && (
                  <p className="list-item-meta">{locale === "fi" ? "ka" : "avg"} <F v={income.average_amount} /></p>
                )}
                <span onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={!!income.is_active}
                    onCheckedChange={() => toggleIncome(income.id, income.is_active)}
                  />
                </span>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "fi" ? "Muokkaa tuloa" : "Edit income"}</DialogTitle></DialogHeader>
          {editTarget && (
            <form ref={editFormRef} onSubmit={handleEdit} className="form-stack">
              <div className="form-field">
                <Label>{t.income.name}</Label>
                <Input name="name" defaultValue={editTarget.name} required />
              </div>
              <div className="form-grid-2">
                <div className="form-field">
                  <Label>{t.income.amountEur}</Label>
                  <Input name="amount" type="text" inputMode="decimal" defaultValue={editTarget.amount} required />
                </div>
                <div className="form-field">
                  <Label>{t.income.expectedDay}</Label>
                  <Input name="expected_day" type="number" min="0" max="31" defaultValue={editTarget.expected_day} required />
                </div>
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Tulotili" : "Target account"}</Label>
                <select
                  className="input"
                  value={editTargetAccount}
                  onChange={(e) => setEditTargetAccount(e.target.value)}
                >
                  <option value="">{locale === "fi" ? "Käytä Synci-mappausta" : "Use Synci mapping"}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <p className="settings-help">
                  {locale === "fi"
                    ? "Valitse tili, jolle tämä tulo kirjataan YNABissa. Käytä jos pankki maksaa eri tilille kuin haluat seurata."
                    : "Pick the YNAB account this income should be posted to. Use when the deposit lands on a different account than you want to track."}
                </p>
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Yhdistä maksajaan" : "Match payee"}</Label>
                <div className="match-pattern-row">
                  <Input
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                    placeholder={locale === "fi" ? "esim. *Maksaja*" : "e.g. *Payer*"}
                    className="match-pattern-input"
                    autoComplete="off"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => addPattern(editTarget.id)}>{locale === "fi" ? "Lisää" : "Add"}</Button>
                </div>
                <div className="form-grid-2">
                  <Input
                    value={patternMinAmount}
                    onChange={(e) => setPatternMinAmount(e.target.value)}
                    placeholder={locale === "fi" ? "Min €" : "Min €"}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="match-pattern-input"
                  />
                  <Input
                    value={patternMaxAmount}
                    onChange={(e) => setPatternMaxAmount(e.target.value)}
                    placeholder={locale === "fi" ? "Max €" : "Max €"}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="match-pattern-input"
                  />
                </div>
                {(patterns[editTarget.id] || []).length > 0 && (
                  <div className="match-pattern-list">
                    {patterns[editTarget.id].map((p) => (
                      <div key={p.id} className="match-pattern-item">
                        <span className="match-pattern-tag">{p.payee_pattern}</span>
                        <button type="button" className="batch-remove-btn" onClick={() => deletePattern(p.id)}>
                          <X />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-grid-2">
                <Button type="button" variant="destructive" onClick={() => { deleteIncome(editTarget.id); setEditOpen(false); }}>
                  {t.common.delete}
                </Button>
                <Button type="submit">{t.common.save}</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
