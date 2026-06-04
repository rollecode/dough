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
import { ChevronLeft, ChevronRight, Loader2, Plus, Settings, GripVertical } from "lucide-react";
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
  const [manageOrder, setManageOrder] = useState<BudgetCategory[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
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

  // Keep the manage-dialog ordering in sync with loaded categories
  useEffect(() => {
    if (data?.categories) setManageOrder(data.categories);
  }, [data]);

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const reordered = [...manageOrder];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setManageOrder(reordered);
    setDragIdx(idx);
  };
  const handleDragEnd = () => {
    setDragIdx(null);
    const order = manageOrder.map((c) => c.id);
    fetch("/api/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    }).then(() => load(month)).catch(() => {});
    console.info("[budget] Saved category order");
  };

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
      <div className="budget-topbar">
        <div className="budget-monthnav">
          <button type="button" className="budget-monthnav-arrow" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            <ChevronLeft />
          </button>
          <span className="budget-monthnav-label">{formatMonth(month, locale)}</span>
          <button type="button" className="budget-monthnav-arrow" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
            <ChevronRight />
          </button>
          <button
            type="button"
            className={`budget-monthnav-today ${month === thisMonth() ? "is-hidden" : ""}`}
            onClick={() => setMonth(thisMonth())}
            tabIndex={month === thisMonth() ? -1 : 0}
          >
            {locale === "fi" ? "Tänään" : "Today"}
          </button>
        </div>
        <button type="button" className="budget-manage-btn" onClick={() => setManageOpen(true)} aria-label={locale === "fi" ? "Hallinnoi" : "Manage"}>
          <Settings />
        </button>
      </div>

      {(() => {
        const rta = data?.readyToAssign || 0;
        const state = rta > 0.005 ? "is-positive" : rta < -0.005 ? "is-negative" : "is-zero";
        const label = state === "is-zero"
          ? (locale === "fi" ? "Kaikki rahat jaettu" : "All money assigned")
          : state === "is-negative"
          ? (locale === "fi" ? "Liikaa budjetoitu" : "Over-assigned")
          : (locale === "fi" ? "Budjetoimatonta rahaa" : "Ready to assign");
        return (
          <div className="budget-ready-wrap">
            <div className={`budget-ready-box ${state}`}>
              <span className="budget-ready-value"><F v={rta} s=" €" /></span>
              <span className="budget-ready-label">{label}</span>
            </div>
          </div>
        );
      })()}

      <div className="budget-table">
      <div className="budget-grid budget-table-header">
        <span>{locale === "fi" ? "Kategoria" : "Category"}</span>
        <span>{locale === "fi" ? "Budjetoitu" : "Assigned"}</span>
        <span>{locale === "fi" ? "Toteuma" : "Activity"}</span>
        <span>{locale === "fi" ? "Käytettävissä" : "Available"}</span>
      </div>

      {[...groups.entries()].map(([groupName, items]) => {
        const groupBudgeted = items.reduce((s, c) => s + c.budgeted, 0);
        const groupActivity = items.reduce((s, c) => s + c.activity, 0);
        const groupAvailable = items.reduce((s, c) => s + c.available, 0);
        return (
          <Card key={groupName} className="list-card list-card-divider">
            <div className="budget-grid budget-group-header">
              <span className="budget-group-name">{groupName}</span>
              <span className="budget-num"><F v={groupBudgeted} /></span>
              <span className="budget-num text-muted"><F v={groupActivity} /></span>
              <span className="budget-num">
                <span className={`budget-pill ${groupAvailable > 0 ? "is-positive" : groupAvailable < 0 ? "is-negative" : "is-zero"}`}>
                  <F v={groupAvailable} />
                </span>
              </span>
            </div>
            {items.map((c) => (
              <BudgetRow
                key={c.id}
                cat={c}
                saving={savingId === c.id}
                onSave={(v) => saveBudgeted(c.id, v)}
                onOpenTarget={() => { setTargetCat(c); setTargetDraft(c.target_monthly ? fmt(c.target_monthly) : ""); }}
                fmt={fmt}
                month={month}
                locale={locale}
              />
            ))}
          </Card>
        );
      })}
      </div>

      {/* Manage categories dialog */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "fi" ? "Hallinnoi kategorioita" : "Manage categories"}</DialogTitle></DialogHeader>
          <div className="form-stack">
            <Button variant="outline" size="sm" onClick={() => { setManageOpen(false); setAddCatOpen(true); }}>
              <Plus className="icon-sm" />
              {locale === "fi" ? "Lisää kategoria" : "Add category"}
            </Button>
            <p className="settings-help">{locale === "fi" ? "Vedä järjestääksesi. Napauta muokataksesi." : "Drag to reorder. Tap to edit."}</p>
            <div className="manage-cat-list">
              {manageOrder.map((c, idx) => (
                <div
                  key={c.id}
                  className={`manage-cat-row ${dragIdx === idx ? "is-dragging" : ""}`}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                >
                  <GripVertical className="manage-cat-grip" />
                  <button type="button" className="manage-cat-main" onClick={() => { setManageOpen(false); setEditCat(c); }}>
                    <span className={`manage-cat-name ${!c.is_active ? "is-inactive" : ""}`}>{c.name}</span>
                    {c.group_name && <span className="manage-cat-group">{c.group_name}</span>}
                  </button>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Switch checked={!!c.is_active} onCheckedChange={() => toggleActive(c)} />
                  </span>
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
              {targetCat.target_monthly > 0 && (
                <div className="form-field">
                  <Label>{locale === "fi" ? "Tämä kuukausi" : "This month"}</Label>
                  {targetCat.snooze_until_month >= month ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => { unsnoozeTarget(targetCat.id); setTargetCat(null); }}>
                      {locale === "fi" ? "Jatka tavoitetta" : "Resume target"}
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => { snoozeTarget(targetCat.id); setTargetCat(null); }}>
                      {locale === "fi" ? "Tauota tämä kuukausi" : "Snooze this month"}
                    </Button>
                  )}
                </div>
              )}
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

function BudgetRow({ cat, saving, onSave, onOpenTarget, fmt, month, locale }: {
  cat: BudgetCategory;
  saving: boolean;
  onSave: (value: number) => void;
  onOpenTarget: () => void;
  fmt: (v: number) => string;
  month: string;
  locale: string;
}) {
  const [draft, setDraft] = useState<string>(cat.budgeted ? fmt(cat.budgeted) : "");
  const [invalid, setInvalid] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const calcPress = (key: string) => {
    if (key === "C") { setDraft(""); return; }
    if (key === "back") { setDraft((d) => d.slice(0, -1)); return; }
    if (key === "=") {
      const value = evalExpression(draft);
      if (value !== null) { setDraft(fmt(value)); setInvalid(false); }
      else setInvalid(true);
      return;
    }
    setDraft((d) => d + key);
  };

  const hasTarget = cat.target_monthly > 0;
  const isSnoozedThisMonth = hasTarget && cat.snooze_until_month >= month;
  const progress = hasTarget ? Math.min(1, cat.budgeted / cat.target_monthly) : 0;
  const underfunded = cat.target_active && cat.budgeted < cat.target_monthly - 0.005;
  const stillNeeded = underfunded ? Math.round((cat.target_monthly - cat.budgeted) * 100) / 100 : 0;
  const pillClass = cat.available < -0.005
    ? "is-negative"
    : underfunded
    ? "is-underfunded"
    : cat.available > 0.005
    ? "is-positive"
    : "is-zero";

  return (
    <div className="budget-grid budget-row">
      <button type="button" className="budget-row-main" onClick={onOpenTarget}>
        <span className="budget-row-name">{cat.name}</span>
        {hasTarget && (
          <span className="budget-row-target">
            <span className="budget-target-progress">
              <span className="budget-target-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
            <span className={`budget-target-text ${isSnoozedThisMonth ? "is-snoozed" : underfunded ? "is-underfunded" : ""}`}>
              {isSnoozedThisMonth
                ? (locale === "fi" ? "tauolla" : "paused")
                : underfunded
                ? <><F v={stillNeeded} /> € {locale === "fi" ? "lisää" : "to go"}</>
                : (locale === "fi" ? "valmis" : "funded")}
            </span>
          </span>
        )}
      </button>
      <span className="budget-num budget-assigned-cell">
        <button
          tabIndex={-1}
          className="button-calculator"
          aria-hidden="true"
          type="button"
          onClick={() => setCalcOpen((o) => !o)}
        >
          <svg className="icon-calculator" viewBox="0 0 16 16"><path d="m3.8 0 .5.5v2.3h2.2l.5.5v.5l-.5.5H4.3v2.2l-.5.5h-.5l-.5-.5V4.3H.5L0 3.8v-.5l.5-.5h2.3V.5l.5-.5zM9 3.3l.5-.5h6l.5.5v.5l-.5.5h-6L9 3.8zm3.5 7.7a1 1 0 1 0 0-2 1 1 0 0 0 0 2m0 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2M9 12.3a.5.5 0 0 1 .5-.6h6a.5.5 0 0 1 .5.6v.4a.5.5 0 0 1-.5.6h-6a.5.5 0 0 1-.5-.6zm-2.8-2.1v.7l-1.6 1.6 1.6 1.6v.7l-.4.4h-.7l-1.6-1.6-1.6 1.6h-.7l-.4-.4v-.7l1.6-1.6L1 10.9v-.7l.3-.4H2l1.6 1.6 1.6-1.6h.7z"/></svg>
        </button>
        <Input
          ref={inputRef}
          className={`budget-budgeted-input ${invalid ? "is-invalid" : ""}`}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          type="text"
          inputMode="decimal"
          placeholder="0"
          disabled={saving}
        />
        {calcOpen && (
          <>
            <div className="budget-calc-backdrop" onClick={() => { setCalcOpen(false); commit(); }} />
            <div className="budget-calc-popover">
              <div className="budget-calc-display">{draft || "0"}</div>
              <div className="budget-calc-grid">
                {["7","8","9","/","4","5","6","*","1","2","3","-","0",".","=","+"].map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`budget-calc-key ${k === "=" ? "is-equals" : ""}`}
                    onClick={() => calcPress(k)}
                  >
                    {k}
                  </button>
                ))}
                <button type="button" className="budget-calc-key is-wide" onClick={() => calcPress("back")}>⌫</button>
                <button type="button" className="budget-calc-key is-wide" onClick={() => calcPress("C")}>C</button>
                <button type="button" className="budget-calc-key is-done" onClick={() => { setCalcOpen(false); commit(); }}>
                  {locale === "fi" ? "Valmis" : "Done"}
                </button>
              </div>
            </div>
          </>
        )}
      </span>
      <span className="budget-num text-muted">{cat.activity > 0 ? <>−<F v={cat.activity} /></> : <F v={0} />}</span>
      <span className="budget-num">
        <span className={`budget-pill ${pillClass}`}><F v={cat.available} /></span>
      </span>
    </div>
  );
}
