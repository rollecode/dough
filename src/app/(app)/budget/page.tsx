"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocale } from "@/lib/locale-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Loader2, Plus, Settings } from "lucide-react";
import { F } from "@/components/ui/f";

interface BudgetCategory {
  id: number;
  name: string;
  group_name: string;
  is_active: number;
  budgeted: number;
  activity: number;
  carryover: number;
  available: number;
  target_monthly: number;
  snooze_until_month: string;
  target_active: boolean;
}

interface BudgetData {
  month: string;
  categories: BudgetCategory[];
  income: number;
  totalBudgeted: number;
  readyToAssign: number;
}

// Safe expression evaluator: only allows digits, decimal/comma separators and basic operators
function evalExpression(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  if (!/^[\d.,+\-*/() ]+$/.test(trimmed)) return null;
  try {
    const cleaned = trimmed.replace(/,/g, ".").replace(/\s+/g, "");
    if (/^[\d.]+$/.test(cleaned)) return parseFloat(cleaned);
    const result = Function(`"use strict"; return (${cleaned})`)();
    return typeof result === "number" && isFinite(result) ? Math.round(result * 100) / 100 : null;
  } catch {
    return null;
  }
}

function thisMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(month: string, locale: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(locale === "fi" ? "fi" : "en", { month: "long", year: "numeric" });
}

export default function BudgetPage() {
  const { locale, fmt } = useLocale();
  const [month, setMonth] = useState<string>(thisMonth());
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [manageOpen, setManageOpen] = useState(false);
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [editCat, setEditCat] = useState<BudgetCategory | null>(null);
  const [targetCat, setTargetCat] = useState<BudgetCategory | null>(null);
  const [targetDraft, setTargetDraft] = useState<string>("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const addCatRef = useRef<HTMLFormElement>(null);
  const editCatRef = useRef<HTMLFormElement>(null);

  const load = useCallback((m: string) => {
    console.debug("[budget] Loading month", m);
    setLoading(true);
    fetch(`/api/budget?month=${m}`)
      .then((r) => r.json())
      .then((d) => { if (d.month) setData(d); })
      .catch((err) => console.error("[budget] Load error:", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(month); }, [load, month]);

  const saveBudgeted = async (catId: number, value: number) => {
    setSavingId(catId);
    try {
      await fetch("/api/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, category_id: catId, budgeted: value }),
      });
      load(month);
    } catch (err) {
      console.error("[budget] Save error:", err);
    } finally {
      setSavingId(null);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addCatRef.current) return;
    const fd = new FormData(addCatRef.current);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fd.get("name"), group_name: fd.get("group_name") }),
      });
      if (res.ok) {
        addCatRef.current.reset();
        setAddCatOpen(false);
        load(month);
      } else {
        const j = await res.json();
        alert(j.error || "Failed");
      }
    } catch (err) {
      console.error("[budget] Add category error:", err);
    }
  };

  const handleEditCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCat || !editCatRef.current) return;
    const fd = new FormData(editCatRef.current);
    try {
      await fetch("/api/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editCat.id, name: fd.get("name"), group_name: fd.get("group_name") }),
      });
      setEditCat(null);
      load(month);
    } catch (err) {
      console.error("[budget] Edit category error:", err);
    }
  };

  const saveTarget = async () => {
    if (!targetCat) return;
    const value = evalExpression(targetDraft);
    if (value === null) return;
    try {
      await fetch("/api/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: targetCat.id, monthly_amount: value }),
      });
      setTargetCat(null);
      setTargetDraft("");
      load(month);
    } catch (err) {
      console.error("[budget] Save target error:", err);
    }
  };

  const clearTarget = async (catId: number) => {
    try {
      await fetch("/api/targets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: catId }),
      });
      setTargetCat(null);
      load(month);
    } catch (err) {
      console.error("[budget] Clear target error:", err);
    }
  };

  const snoozeTarget = async (catId: number) => {
    try {
      await fetch("/api/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: catId, snooze_until_month: month }),
      });
      load(month);
    } catch (err) {
      console.error("[budget] Snooze error:", err);
    }
  };

  const unsnoozeTarget = async (catId: number) => {
    try {
      await fetch("/api/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: catId, snooze_until_month: "" }),
      });
      load(month);
    } catch (err) {
      console.error("[budget] Unsnooze error:", err);
    }
  };

  const toggleActive = async (c: BudgetCategory) => {
    try {
      await fetch("/api/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, is_active: !c.is_active }),
      });
      load(month);
    } catch (err) {
      console.error("[budget] Toggle error:", err);
    }
  };

  if (loading && !data) {
    return <div className="page-loading"><Loader2 className="page-loading-spinner animate-spin" /></div>;
  }

  const groups = new Map<string, BudgetCategory[]>();
  for (const c of data?.categories || []) {
    if (!c.is_active) continue;
    const g = c.group_name || (locale === "fi" ? "Muut" : "Other");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(c);
  }

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <div>
          <h1 className="page-heading">{locale === "fi" ? "Budjetti" : "Budget"}</h1>
          <p className="page-subtitle">{locale === "fi" ? "Jaa rahat kuukauden kategorioille" : "Allocate money to monthly categories"}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}>
          <Settings className="icon-sm" />
          {locale === "fi" ? "Hallinnoi" : "Manage"}
        </Button>
      </div>

      <div className="budget-month-bar">
        <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft className="icon-sm" />
        </Button>
        <span className="budget-month-label">{formatMonth(month, locale)}</span>
        <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight className="icon-sm" />
        </Button>
        {month !== thisMonth() && (
          <Button variant="outline" size="sm" onClick={() => setMonth(thisMonth())}>
            {locale === "fi" ? "Tämä kuukausi" : "This month"}
          </Button>
        )}
      </div>

      <Card className={`budget-ready-card ${data && data.readyToAssign >= 0 ? "is-positive" : "is-negative"}`}>
        <p className="budget-ready-label">
          {locale === "fi" ? "Budjetoimatonta rahaa" : "Unallocated money"}
        </p>
        <p className="budget-ready-value">
          <F v={data?.readyToAssign || 0} s=" €" />
        </p>
        <p className="budget-ready-note">
          {locale === "fi" ? "Tulot" : "Income"} <F v={data?.income || 0} s=" €" />
          {" − "}
          {locale === "fi" ? "Budjetoitu" : "Budgeted"} <F v={data?.totalBudgeted || 0} s=" €" />
        </p>
      </Card>

      {[...groups.entries()].map(([groupName, items]) => {
        const groupBudgeted = items.reduce((s, c) => s + c.budgeted, 0);
        const groupActivity = items.reduce((s, c) => s + c.activity, 0);
        const groupAvailable = items.reduce((s, c) => s + c.available, 0);
        return (
          <Card key={groupName} className="list-card list-card-divider">
            <div className="budget-group-header">
              <span className="budget-group-name">{groupName}</span>
              <div className="budget-group-totals">
                <span><F v={groupBudgeted} /></span>
                <span className="text-negative"><F v={groupActivity} /></span>
                <span className={groupAvailable >= 0 ? "text-positive" : "text-negative"}><F v={groupAvailable} /></span>
              </div>
            </div>
            {items.map((c) => (
              <BudgetRow
                key={c.id}
                cat={c}
                saving={savingId === c.id}
                onSave={(v) => saveBudgeted(c.id, v)}
                onOpenTarget={() => { setTargetCat(c); setTargetDraft(c.target_monthly ? fmt(c.target_monthly) : ""); }}
                onSnooze={() => snoozeTarget(c.id)}
                onUnsnooze={() => unsnoozeTarget(c.id)}
                fmt={fmt}
                month={month}
                locale={locale}
              />
            ))}
          </Card>
        );
      })}

      {/* Manage categories dialog */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "fi" ? "Hallinnoi kategorioita" : "Manage categories"}</DialogTitle></DialogHeader>
          <div className="form-stack">
            <Button onClick={() => { setManageOpen(false); setAddCatOpen(true); }}>
              <Plus className="icon-sm" />
              {locale === "fi" ? "Lisää kategoria" : "Add category"}
            </Button>
            <div className="match-pattern-list">
              {(data?.categories || []).map((c) => (
                <div key={c.id} className="list-item">
                  <div className="list-item-body">
                    <p className={`list-item-name ${!c.is_active ? "is-inactive" : ""}`}>{c.name}</p>
                    <p className="list-item-meta">{c.group_name}</p>
                  </div>
                  <div className="list-item-end">
                    <Switch checked={!!c.is_active} onCheckedChange={() => toggleActive(c)} />
                    <Button variant="outline" size="sm" onClick={() => { setManageOpen(false); setEditCat(c); }}>
                      {locale === "fi" ? "Muokkaa" : "Edit"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add category dialog */}
      <Dialog open={addCatOpen} onOpenChange={setAddCatOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "fi" ? "Uusi kategoria" : "New category"}</DialogTitle></DialogHeader>
          <form ref={addCatRef} onSubmit={handleAddCategory} className="form-stack">
            <div className="form-field">
              <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
              <Input name="name" required autoComplete="off" />
            </div>
            <div className="form-field">
              <Label>{locale === "fi" ? "Ryhmä" : "Group"}</Label>
              <Input name="group_name" autoComplete="off" />
            </div>
            <Button type="submit">{locale === "fi" ? "Lisää" : "Add"}</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Target editor dialog */}
      <Dialog open={!!targetCat} onOpenChange={(open) => { if (!open) { setTargetCat(null); setTargetDraft(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {locale === "fi" ? "Kuukausitavoite" : "Monthly target"}
              {targetCat && ` — ${targetCat.name}`}
            </DialogTitle>
          </DialogHeader>
          {targetCat && (
            <div className="form-stack">
              <div className="form-field">
                <Label>{locale === "fi" ? "Summa per kuukausi (€)" : "Amount per month (€)"}</Label>
                <Input
                  value={targetDraft}
                  onChange={(e) => setTargetDraft(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  autoFocus
                />
                <p className="settings-help">
                  {locale === "fi"
                    ? "Esim. 200 tarkoittaa että tähän kategoriaan jaetaan 200 € joka kuukausi."
                    : "E.g. 200 means 200 € is assigned to this category every month."}
                </p>
              </div>
              <div className="form-grid-2">
                {targetCat.target_monthly > 0 && (
                  <Button type="button" variant="destructive" onClick={() => clearTarget(targetCat.id)}>
                    {locale === "fi" ? "Poista tavoite" : "Clear target"}
                  </Button>
                )}
                <Button type="button" onClick={saveTarget}>{locale === "fi" ? "Tallenna" : "Save"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit category dialog */}
      <Dialog open={!!editCat} onOpenChange={(open) => { if (!open) setEditCat(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "fi" ? "Muokkaa kategoriaa" : "Edit category"}</DialogTitle></DialogHeader>
          {editCat && (
            <form ref={editCatRef} onSubmit={handleEditCategory} className="form-stack">
              <div className="form-field">
                <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
                <Input name="name" defaultValue={editCat.name} required autoComplete="off" />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Ryhmä" : "Group"}</Label>
                <Input name="group_name" defaultValue={editCat.group_name} autoComplete="off" />
              </div>
              <Button type="submit">{locale === "fi" ? "Tallenna" : "Save"}</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BudgetRow({ cat, saving, onSave, onOpenTarget, onSnooze, onUnsnooze, fmt, month, locale }: {
  cat: BudgetCategory;
  saving: boolean;
  onSave: (value: number) => void;
  onOpenTarget: () => void;
  onSnooze: () => void;
  onUnsnooze: () => void;
  fmt: (v: number) => string;
  month: string;
  locale: string;
}) {
  const [draft, setDraft] = useState<string>(cat.budgeted ? fmt(cat.budgeted) : "");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(cat.budgeted ? fmt(cat.budgeted) : "");
  }, [cat.budgeted, fmt]);

  const commit = () => {
    const value = evalExpression(draft);
    if (value === null) { setInvalid(true); return; }
    setInvalid(false);
    if (Math.abs(value - cat.budgeted) < 0.005) return;
    onSave(value);
  };

  const hasTarget = cat.target_monthly > 0;
  const isSnoozedThisMonth = hasTarget && cat.snooze_until_month >= month;
  const progress = hasTarget ? Math.min(1, cat.budgeted / cat.target_monthly) : 0;

  return (
    <div className="budget-row">
      <div className="budget-row-main">
        <div className="budget-row-name">{cat.name}</div>
        {hasTarget && (
          <div className="budget-row-target">
            <div className="budget-target-progress">
              <div className="budget-target-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className={`budget-target-text ${isSnoozedThisMonth ? "is-snoozed" : ""}`}>
              {locale === "fi" ? "Tavoite" : "Target"} <F v={cat.target_monthly} />€/{locale === "fi" ? "kk" : "mo"}
              {isSnoozedThisMonth && ` · ${locale === "fi" ? "snoozattu" : "snoozed"}`}
            </span>
            <button type="button" className="budget-target-action" onClick={isSnoozedThisMonth ? onUnsnooze : onSnooze}>
              {isSnoozedThisMonth ? (locale === "fi" ? "Palauta" : "Resume") : (locale === "fi" ? "Snoozaa" : "Snooze")}
            </button>
            <button type="button" className="budget-target-action" onClick={onOpenTarget}>
              {locale === "fi" ? "Muokkaa" : "Edit"}
            </button>
          </div>
        )}
        {!hasTarget && (
          <button type="button" className="budget-target-add" onClick={onOpenTarget}>
            {locale === "fi" ? "+ Aseta tavoite" : "+ Set target"}
          </button>
        )}
      </div>
      <div className="budget-row-inputs">
        <Input
          className={`budget-budgeted-input ${invalid ? "is-invalid" : ""}`}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          type="text"
          inputMode="decimal"
          placeholder="0"
          disabled={saving}
        />
        <span className="budget-row-activity">−<F v={cat.activity} /></span>
        <span className={`budget-row-available ${cat.available >= 0 ? "text-positive" : "text-negative"}`}>
          <F v={cat.available} />
        </span>
      </div>
    </div>
  );
}
