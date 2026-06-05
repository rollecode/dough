"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocale } from "@/lib/locale-context";
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
import { ChevronLeft, ChevronRight, ChevronDown, Loader2, Plus, GripVertical, Pencil, EyeOff, Eye, Check, ArrowRightLeft } from "lucide-react";
import { F } from "@/components/ui/f";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [inspectorId, setInspectorId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [targetEditing, setTargetEditing] = useState(false);
  const [targetDraft, setTargetDraft] = useState<string>("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveOther, setMoveOther] = useState<string>("");
  const [moveDraft, setMoveDraft] = useState<string>("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [localGroups, setLocalGroups] = useState<{ key: string; label: string; items: BudgetCategory[] }[]>([]);
  const [bdrag, setBdrag] = useState<{ type: "row" | "group"; groupKey: string; index: number } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [filter, setFilter] = useState<"all" | "overspent" | "available">("all");
  const addCatRef = useRef<HTMLFormElement>(null);
  const renameRef = useRef<HTMLFormElement>(null);

  const inspectorCat = inspectorId !== null ? (data?.categories.find((c) => c.id === inspectorId) ?? null) : null;
  const closeInspector = () => {
    setInspectorId(null);
    setRenaming(false);
    setTargetEditing(false);
    setTargetDraft("");
    setMoveOpen(false);
    setMoveOther("");
    setMoveDraft("");
  };

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

  // Build the grouped, ordered structure the budget view renders (and drags)
  useEffect(() => {
    if (!data?.categories) { setLocalGroups([]); return; }
    const map = new Map<string, { key: string; label: string; items: BudgetCategory[] }>();
    for (const c of data.categories) {
      if (!c.is_active) continue;
      const key = c.group_name || "";
      if (!map.has(key)) map.set(key, { key, label: key || (locale === "fi" ? "Muut" : "Other"), items: [] });
      map.get(key)!.items.push(c);
    }
    setLocalGroups([...map.values()]);
  }, [data, locale]);

  // Drag-and-drop reorder inside the budget view: rows within a group, and whole groups
  const persistRowOrder = (groups: typeof localGroups) => {
    const order = groups.flatMap((g) => g.items.map((c) => c.id));
    fetch("/api/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    }).then(() => load(month)).catch(() => {});
    console.info("[budget] Saved row order");
  };

  const persistGroupOrder = (groups: typeof localGroups) => {
    const order = groups.map((g) => g.key);
    fetch("/api/household", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budget_group_order: JSON.stringify(order) }),
    }).then(() => load(month)).catch(() => {});
    console.info("[budget] Saved group order");
  };

  const onRowDragStart = (groupKey: string, index: number) => setBdrag({ type: "row", groupKey, index });
  const onRowDragOver = (e: React.DragEvent, groupKey: string, index: number) => {
    if (!bdrag || bdrag.type !== "row" || bdrag.groupKey !== groupKey || bdrag.index === index) return;
    e.preventDefault();
    setLocalGroups((prev) => {
      const next = prev.map((g) => (g.key === groupKey ? { ...g, items: [...g.items] } : g));
      const g = next.find((x) => x.key === groupKey)!;
      const [moved] = g.items.splice(bdrag.index, 1);
      g.items.splice(index, 0, moved);
      return next;
    });
    setBdrag({ ...bdrag, index });
  };

  const onGroupDragStart = (index: number) => setBdrag({ type: "group", groupKey: "", index });
  const onGroupDragOver = (e: React.DragEvent, index: number) => {
    if (!bdrag || bdrag.type !== "group" || bdrag.index === index) return;
    e.preventDefault();
    setLocalGroups((prev) => {
      const next = [...prev];
      const [moved] = next.splice(bdrag.index, 1);
      next.splice(index, 0, moved);
      return next;
    });
    setBdrag({ ...bdrag, index });
  };

  const onBudgetDragEnd = () => {
    if (!bdrag) return;
    if (bdrag.type === "row") persistRowOrder(localGroups);
    else persistGroupOrder(localGroups);
    setBdrag(null);
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

  const saveTarget = async () => {
    if (!inspectorCat) return;
    const value = evalExpression(targetDraft);
    if (value === null) return;
    try {
      await fetch("/api/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: inspectorCat.id, monthly_amount: value }),
      });
      setTargetEditing(false);
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
      setTargetEditing(false);
      setTargetDraft("");
      load(month);
    } catch (err) {
      console.error("[budget] Clear target error:", err);
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectorCat || !renameRef.current) return;
    const fd = new FormData(renameRef.current);
    try {
      await fetch("/api/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: inspectorCat.id, name: fd.get("name"), group_name: fd.get("group_name") }),
      });
      setRenaming(false);
      load(month);
    } catch (err) {
      console.error("[budget] Rename category error:", err);
    }
  };

  const moveMoney = async (fromId: number, toId: number, amount: number) => {
    if (!fromId || !toId || fromId === toId || !(amount > 0)) return;
    try {
      await fetch("/api/budget/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, from_category_id: fromId, to_category_id: toId, amount }),
      });
      setMoveOpen(false);
      setMoveOther("");
      setMoveDraft("");
      load(month);
    } catch (err) {
      console.error("[budget] Move money error:", err);
    }
  };

  // Cover an overspent category from ready-to-assign (raise its assigned) or another category (move)
  const coverOverspend = async (cat: BudgetCategory, source: number | "rta", amount: number) => {
    if (!(amount > 0)) return;
    if (source === "rta") {
      await saveBudgeted(cat.id, Math.round((cat.budgeted + amount) * 100) / 100);
    } else {
      await moveMoney(source, cat.id, amount);
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
          {month !== thisMonth() && (
            <button type="button" className="budget-monthnav-today" onClick={() => setMonth(thisMonth())}>
              {locale === "fi" ? "Tänään" : "Today"}
            </button>
          )}
        </div>
        <div className="budget-topbar-right">
          {(() => {
            const rta = data?.readyToAssign || 0;
            const state = rta > 0.005 ? "is-positive" : rta < -0.005 ? "is-negative" : "is-zero";
            const label = state === "is-zero"
              ? (locale === "fi" ? "Kaikki jaettu" : "All assigned")
              : state === "is-negative"
              ? (locale === "fi" ? "Liikaa budjetoitu" : "Over-assigned")
              : (locale === "fi" ? "Jaettavissa" : "Ready to assign");
            return (
              <div className={`budget-ready-box ${state}`}>
                <span className="budget-ready-value"><F v={rta} s=" €" /></span>
                <span className="budget-ready-label">{label}</span>
              </div>
            );
          })()}
          <button type="button" className="budget-manage-btn" onClick={() => setAddCatOpen(true)} aria-label={locale === "fi" ? "Lisää kategoria" : "Add category"}>
            <Plus />
          </button>
        </div>
      </div>

      <div className="budget-filterbar">
        {([
          ["all", locale === "fi" ? "Kaikki" : "All"],
          ["overspent", locale === "fi" ? "Ylitetyt" : "Overspent"],
          ["available", locale === "fi" ? "Rahaa jäljellä" : "Money available"],
        ] as const).map(([key, lbl]) => (
          <button
            key={key}
            type="button"
            className={`budget-filter ${filter === key ? "is-active" : ""}`}
            onClick={() => setFilter(key)}
          >
            {lbl}
          </button>
        ))}
      </div>

      <div className={`budget-table ${bdrag ? "is-reordering" : ""}`}>
      <div className="budget-grid budget-table-header">
        <span>{locale === "fi" ? "Kategoria" : "Category"}</span>
        <span>{locale === "fi" ? "Budjetoitu" : "Assigned"}</span>
        <span>{locale === "fi" ? "Toteuma" : "Activity"}</span>
        <span>{locale === "fi" ? "Käytettävissä" : "Available"}</span>
      </div>

      {localGroups.map((group, gIdx) => {
        const items = group.items;
        const groupBudgeted = items.reduce((s, c) => s + c.budgeted, 0);
        const groupActivity = items.reduce((s, c) => s + c.activity, 0);
        const groupAvailable = items.reduce((s, c) => s + c.available, 0);
        const dragEnabled = filter === "all";
        const visibleItems = dragEnabled
          ? items
          : items.filter((c) => (filter === "overspent" ? c.available < -0.005 : c.available > 0.005));
        if (!dragEnabled && visibleItems.length === 0) return null;
        const draggingGroup = bdrag?.type === "group";
        const draggingRow = bdrag?.type === "row";
        // Collapse to header-only: all groups while dragging a group, other groups while dragging a row
        const collapsed = dragEnabled && (draggingGroup || (draggingRow && bdrag!.groupKey !== group.key));
        const isGroupSource = draggingGroup && bdrag!.index === gIdx;
        return (
          <Card
            key={group.key}
            className={`list-card list-card-divider ${collapsed ? "is-collapsed" : ""} ${isGroupSource ? "is-drag-source" : ""}`}
            onDragOver={dragEnabled ? (e) => onGroupDragOver(e, gIdx) : undefined}
          >
            <div
              className="budget-grid budget-group-header"
              draggable={dragEnabled}
              onDragStart={dragEnabled ? () => onGroupDragStart(gIdx) : undefined}
              onDragEnd={dragEnabled ? onBudgetDragEnd : undefined}
            >
              {dragEnabled && <span className="budget-grip budget-group-grip" aria-hidden="true"><GripVertical /></span>}
              <span className="budget-group-name">{group.label}</span>
              <span className="budget-num"><F v={groupBudgeted} /></span>
              <span className="budget-num text-muted"><F v={groupActivity} /></span>
              <span className="budget-num">
                <span className={`budget-pill ${groupAvailable > 0 ? "is-positive" : groupAvailable < 0 ? "is-negative" : "is-zero"}`}>
                  <F v={groupAvailable} />
                </span>
              </span>
            </div>
            {visibleItems.map((c, rIdx) => {
              const isRowSource = draggingRow && bdrag!.groupKey === group.key && bdrag!.index === rIdx;
              return (
                <div
                  key={c.id}
                  className={`budget-row-drag ${isRowSource ? "is-drag-source" : ""}`}
                  onDragOver={dragEnabled ? (e) => onRowDragOver(e, group.key, rIdx) : undefined}
                >
                  {dragEnabled && (
                    <button
                      type="button"
                      className="budget-grip budget-row-grip"
                      draggable
                      onDragStart={() => onRowDragStart(group.key, rIdx)}
                      onDragEnd={onBudgetDragEnd}
                      aria-label={locale === "fi" ? "Siirrä" : "Reorder"}
                    >
                      <GripVertical />
                    </button>
                  )}
                  <BudgetRow
                    cat={c}
                    saving={savingId === c.id}
                    onSave={(v) => saveBudgeted(c.id, v)}
                    onOpen={() => setInspectorId(c.id)}
                    fmt={fmt}
                    month={month}
                    locale={locale}
                    siblings={data?.categories || []}
                    readyToAssign={data?.readyToAssign || 0}
                    onCover={(source, amount) => coverOverspend(c, source, amount)}
                  />
                </div>
              );
            })}
          </Card>
        );
      })}

      {(() => {
        const hiddenCats = (data?.categories || []).filter((c) => !c.is_active);
        if (hiddenCats.length === 0) return null;
        return (
          <Card className="list-card list-card-divider">
            <button type="button" className="budget-hidden-toggle" onClick={() => setShowHidden((s) => !s)}>
              <ChevronDown className={`budget-hidden-chevron ${showHidden ? "is-open" : ""}`} />
              <span>{locale === "fi" ? "Piilotetut kategoriat" : "Hidden categories"}</span>
              <span className="budget-hidden-count">{hiddenCats.length}</span>
            </button>
            {showHidden && hiddenCats.map((c) => (
              <button key={c.id} type="button" className="budget-hidden-row" onClick={() => setInspectorId(c.id)}>
                <span className="budget-hidden-name">{c.name}</span>
                {c.group_name && <span className="budget-hidden-group">{c.group_name}</span>}
              </button>
            ))}
          </Card>
        );
      })()}
      </div>

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

      {/* Category inspector */}
      <Sheet open={inspectorCat !== null} onOpenChange={(open) => { if (!open) closeInspector(); }}>
        <SheetContent className="budget-inspector">
          {inspectorCat && (() => {
            const c = inspectorCat;
            const availState = c.available > 0.005 ? "is-positive" : c.available < -0.005 ? "is-negative" : "is-zero";
            const hasTarget = c.target_monthly > 0;
            const isSnoozed = hasTarget && c.snooze_until_month >= month;
            const progress = hasTarget ? Math.min(1, c.budgeted / c.target_monthly) : 0;
            return (
              <>
                <SheetHeader className="insp-header">
                  <div className="insp-title-row">
                    <div className="insp-title-text">
                      <SheetTitle>{c.name}</SheetTitle>
                      {c.group_name && <span className="insp-group">{c.group_name}</span>}
                    </div>
                    {!renaming && (
                      <button type="button" className="insp-icon-btn" onClick={() => setRenaming(true)} aria-label={locale === "fi" ? "Muokkaa" : "Edit"}>
                        <Pencil />
                      </button>
                    )}
                  </div>
                  {renaming && (
                    <form ref={renameRef} onSubmit={handleRename} className="insp-rename">
                      <Input name="name" defaultValue={c.name} required autoComplete="off" autoFocus />
                      <Input name="group_name" defaultValue={c.group_name} placeholder={locale === "fi" ? "Ryhmä" : "Group"} autoComplete="off" />
                      <div className="insp-rename-actions">
                        <Button type="submit" size="sm"><Check className="icon-sm" />{locale === "fi" ? "Tallenna" : "Save"}</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)}>{locale === "fi" ? "Peruuta" : "Cancel"}</Button>
                      </div>
                    </form>
                  )}
                </SheetHeader>

                <div className="insp-body">
                  <div className={`insp-available ${availState}`}>
                    <span className="insp-available-value"><F v={c.available} s=" €" /></span>
                    <span className="insp-available-label">
                      {availState === "is-negative" ? (locale === "fi" ? "Ylitetty" : "Overspent") : (locale === "fi" ? "Käytettävissä" : "Available")}
                    </span>
                  </div>

                  <div className="insp-breakdown">
                    <div className="insp-line">
                      <span className="insp-line-label">{locale === "fi" ? "Jäi viime kuulta" : "Left over last month"}</span>
                      <span className="insp-line-value"><F v={c.carryover} s=" €" /></span>
                    </div>
                    <div className="insp-line">
                      <span className="insp-line-label">{locale === "fi" ? "Budjetoitu" : "Assigned"}</span>
                      <InspectorAssign cat={c} fmt={fmt} onSave={(v) => saveBudgeted(c.id, v)} />
                    </div>
                    <div className="insp-line">
                      <span className="insp-line-label">{locale === "fi" ? "Toteuma" : "Activity"}</span>
                      <span className="insp-line-value text-muted">{c.activity > 0 ? <>−<F v={c.activity} s=" €" /></> : <F v={0} s=" €" />}</span>
                    </div>
                  </div>

                  <div className="insp-section">
                    <span className="insp-section-title">{locale === "fi" ? "Tavoite" : "Target"}</span>
                    {targetEditing ? (
                      <div className="insp-target-edit">
                        <Input value={targetDraft} onChange={(e) => setTargetDraft(e.target.value)} placeholder="0.00" inputMode="decimal" autoFocus />
                        <p className="settings-help">{locale === "fi" ? "Summa joka jaetaan tähän joka kuukausi." : "Amount assigned here every month."}</p>
                        <div className="insp-actions">
                          <Button type="button" size="sm" onClick={saveTarget}>{locale === "fi" ? "Tallenna" : "Save"}</Button>
                          {hasTarget && <Button type="button" variant="destructive" size="sm" onClick={() => clearTarget(c.id)}>{locale === "fi" ? "Poista" : "Clear"}</Button>}
                          <Button type="button" variant="ghost" size="sm" onClick={() => { setTargetEditing(false); setTargetDraft(""); }}>{locale === "fi" ? "Peruuta" : "Cancel"}</Button>
                        </div>
                      </div>
                    ) : hasTarget ? (
                      <div className="insp-target">
                        <div className="budget-target-progress insp-target-bar"><span className="budget-target-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                        <p className="insp-target-text">
                          {isSnoozed ? (locale === "fi" ? "Tauolla tässä kuussa" : "Paused this month") : <><F v={c.target_monthly} s=" €" /> {locale === "fi" ? "/ kk" : "/ mo"}</>}
                        </p>
                        <div className="insp-actions">
                          <Button type="button" variant="outline" size="sm" onClick={() => { setTargetDraft(c.target_monthly ? fmt(c.target_monthly) : ""); setTargetEditing(true); }}>{locale === "fi" ? "Muokkaa" : "Edit"}</Button>
                          {isSnoozed ? (
                            <Button type="button" variant="outline" size="sm" onClick={() => unsnoozeTarget(c.id)}>{locale === "fi" ? "Jatka" : "Resume"}</Button>
                          ) : (
                            <Button type="button" variant="outline" size="sm" onClick={() => snoozeTarget(c.id)}>{locale === "fi" ? "Tauota" : "Snooze"}</Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => { setTargetDraft(""); setTargetEditing(true); }}>{locale === "fi" ? "Aseta tavoite" : "Set a target"}</Button>
                    )}
                  </div>

                  {(() => {
                    const others = (data?.categories || []).filter((o) => o.is_active && o.id !== c.id);
                    const isOverspent = c.available < -0.005;
                    const hasMoney = c.available > 0.005;
                    if ((!isOverspent && !hasMoney) || others.length === 0) return null;
                    const title = isOverspent
                      ? (locale === "fi" ? "Kata budjetin ylitys" : "Cover overspending")
                      : (locale === "fi" ? "Siirrä rahaa" : "Move money");
                    return (
                      <div className="insp-section">
                        <span className="insp-section-title">{title}</span>
                        {moveOpen ? (
                          <div className="insp-move">
                            <Select value={moveOther} onValueChange={(v) => v && setMoveOther(v)}>
                              <SelectTrigger className="insp-move-select">
                                <SelectValue placeholder={isOverspent ? (locale === "fi" ? "Mistä katetaan" : "Cover from") : (locale === "fi" ? "Mihin siirretään" : "Move to")} />
                              </SelectTrigger>
                              <SelectContent>
                                {others.map((o) => (
                                  <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input value={moveDraft} onChange={(e) => setMoveDraft(e.target.value)} placeholder="0.00" inputMode="decimal" className="insp-move-amount" />
                            <div className="insp-actions">
                              <Button type="button" size="sm" onClick={() => {
                                const amt = evalExpression(moveDraft);
                                const other = Number(moveOther);
                                if (amt === null || !amt || !other) return;
                                if (isOverspent) moveMoney(other, c.id, amt);
                                else moveMoney(c.id, other, amt);
                              }}>{isOverspent ? (locale === "fi" ? "Kata" : "Cover") : (locale === "fi" ? "Siirrä" : "Move")}</Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => { setMoveOpen(false); setMoveOther(""); setMoveDraft(""); }}>{locale === "fi" ? "Peruuta" : "Cancel"}</Button>
                            </div>
                          </div>
                        ) : (
                          <Button type="button" variant="outline" size="sm" onClick={() => { setMoveOpen(true); setMoveDraft(fmt(Math.abs(c.available))); }}>
                            <ArrowRightLeft className="icon-sm" />
                            {title}
                          </Button>
                        )}
                      </div>
                    );
                  })()}

                  <div className="insp-section insp-section-end">
                    <Button type="button" variant="ghost" size="sm" className="insp-hide" onClick={() => toggleActive(c)}>
                      {c.is_active ? <><EyeOff className="icon-sm" />{locale === "fi" ? "Piilota kategoria" : "Hide category"}</> : <><Eye className="icon-sm" />{locale === "fi" ? "Näytä kategoria" : "Unhide category"}</>}
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BudgetRow({ cat, saving, onSave, onOpen, fmt, month, locale, siblings, readyToAssign, onCover }: {
  cat: BudgetCategory;
  saving: boolean;
  onSave: (value: number) => void;
  onOpen: () => void;
  fmt: (v: number) => string;
  month: string;
  locale: string;
  siblings: BudgetCategory[];
  readyToAssign: number;
  onCover: (source: number | "rta", amount: number) => void;
}) {
  const [draft, setDraft] = useState<string>(cat.budgeted ? fmt(cat.budgeted) : "");
  const [invalid, setInvalid] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [actOpen, setActOpen] = useState(false);
  const [actTxns, setActTxns] = useState<{ id: string; date: string; payee: string; amount: number; memo: string | null }[] | null>(null);
  const [actLoading, setActLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { fmtDate } = useLocale();

  const openActivity = async () => {
    if (actOpen) { setActOpen(false); return; }
    setActOpen(true);
    setActLoading(true);
    try {
      const res = await fetch(`/api/budget/transactions?month=${month}&category=${encodeURIComponent(cat.name)}`);
      const d = await res.json();
      setActTxns(d.transactions || []);
    } catch (err) {
      console.error("[budget] Activity transactions error:", err);
      setActTxns([]);
    } finally {
      setActLoading(false);
    }
  };

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
      <button type="button" className="budget-row-main" onClick={onOpen}>
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
        <Input
          ref={inputRef}
          className={`budget-budgeted-input ${invalid ? "is-invalid" : ""} ${focused ? "is-focused" : ""}`}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
          onFocus={(e) => { setFocused(true); e.target.select(); }}
          onBlur={() => { if (!calcOpen) { setFocused(false); commit(); } }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          type="text"
          inputMode="decimal"
          placeholder="0"
          disabled={saving}
        />
        {focused && (
          <button
            tabIndex={-1}
            className="button-calculator"
            aria-hidden="true"
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setCalcOpen((o) => !o)}
          >
            <svg className="icon-calculator" viewBox="0 0 16 16"><path d="m3.8 0 .5.5v2.3h2.2l.5.5v.5l-.5.5H4.3v2.2l-.5.5h-.5l-.5-.5V4.3H.5L0 3.8v-.5l.5-.5h2.3V.5l.5-.5zM9 3.3l.5-.5h6l.5.5v.5l-.5.5h-6L9 3.8zm3.5 7.7a1 1 0 1 0 0-2 1 1 0 0 0 0 2m0 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2M9 12.3a.5.5 0 0 1 .5-.6h6a.5.5 0 0 1 .5.6v.4a.5.5 0 0 1-.5.6h-6a.5.5 0 0 1-.5-.6zm-2.8-2.1v.7l-1.6 1.6 1.6 1.6v.7l-.4.4h-.7l-1.6-1.6-1.6 1.6h-.7l-.4-.4v-.7l1.6-1.6L1 10.9v-.7l.3-.4H2l1.6 1.6 1.6-1.6h.7z"/></svg>
          </button>
        )}
        {calcOpen && (
          <>
            <div className="budget-calc-backdrop" onClick={() => { setCalcOpen(false); setFocused(false); commit(); }} />
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
                <button type="button" className="budget-calc-key is-done" onClick={() => { setCalcOpen(false); setFocused(false); commit(); }}>
                  {locale === "fi" ? "Valmis" : "Done"}
                </button>
              </div>
            </div>
          </>
        )}
      </span>
      <span className="budget-num text-muted budget-activity-cell">
        {cat.activity > 0 ? (
          <>
            <button type="button" className="budget-activity-btn" onClick={openActivity} aria-haspopup="dialog" aria-expanded={actOpen}>
              −<F v={cat.activity} />
            </button>
            {actOpen && (
              <>
                <div className="budget-calc-backdrop" onClick={() => setActOpen(false)} />
                <div className="budget-act-popover">
                  <div className="budget-act-title">{locale === "fi" ? "Toteuma" : "Activity"} · {cat.name}</div>
                  {actLoading ? (
                    <div className="budget-act-loading"><Loader2 className="icon-sm animate-spin" /></div>
                  ) : actTxns && actTxns.length > 0 ? (
                    <div className="budget-act-list">
                      {actTxns.map((tx) => (
                        <div key={tx.id} className="budget-act-item">
                          <span className="budget-act-info">
                            <span className="budget-act-payee">{tx.payee}</span>
                            <span className="budget-act-date">{fmtDate(tx.date)}</span>
                          </span>
                          <span className="budget-act-amt">−<F v={Math.abs(tx.amount)} s=" €" /></span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="budget-act-empty">{locale === "fi" ? "Ei tapahtumia" : "No transactions"}</p>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <F v={0} />
        )}
      </span>
      <span className="budget-num budget-avail-cell">
        {cat.available < -0.005 ? (
          <>
            <button type="button" className="budget-pill is-negative budget-pill-btn" onClick={() => setCoverOpen((o) => !o)} aria-label={locale === "fi" ? "Kata budjetin ylitys" : "Cover overspending"} aria-haspopup="menu" aria-expanded={coverOpen}>
              <F v={cat.available} />
            </button>
            {coverOpen && (() => {
              const amount = Math.round(Math.abs(cat.available) * 100) / 100;
              const sources = siblings.filter((o) => o.is_active && o.id !== cat.id && o.available > 0.005);
              return (
                <>
                  <div className="budget-calc-backdrop" onClick={() => setCoverOpen(false)} />
                  <div className="budget-cover-popover">
                    <div className="budget-cover-title">
                      {locale === "fi" ? "Kata budjetin ylitys" : "Cover overspending"} <span className="budget-cover-amt"><F v={amount} s=" €" /></span>
                    </div>
                    <div className="budget-cover-list">
                      {readyToAssign > 0.005 && (
                        <button type="button" className="budget-cover-item" onClick={() => { onCover("rta", amount); setCoverOpen(false); }}>
                          <span className="budget-cover-name">{locale === "fi" ? "Budjetoimaton raha" : "Ready to assign"}</span>
                          <span className="budget-cover-src"><F v={readyToAssign} s=" €" /></span>
                        </button>
                      )}
                      {sources.map((o) => (
                        <button key={o.id} type="button" className="budget-cover-item" onClick={() => { onCover(o.id, amount); setCoverOpen(false); }}>
                          <span className="budget-cover-name">{o.name}</span>
                          <span className="budget-cover-src"><F v={o.available} s=" €" /></span>
                        </button>
                      ))}
                      {readyToAssign <= 0.005 && sources.length === 0 && (
                        <p className="budget-cover-empty">{locale === "fi" ? "Ei rahaa katettavaksi" : "No money available to cover"}</p>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </>
        ) : (
          <span className={`budget-pill ${pillClass}`}><F v={cat.available} /></span>
        )}
      </span>
    </div>
  );
}

// Compact assigned editor used inside the category inspector (no calculator popover)
function InspectorAssign({ cat, fmt, onSave }: {
  cat: BudgetCategory;
  fmt: (v: number) => string;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string>(cat.budgeted ? fmt(cat.budgeted) : "");

  useEffect(() => {
    setDraft(cat.budgeted ? fmt(cat.budgeted) : "");
  }, [cat.budgeted, fmt]);

  const commit = () => {
    const value = evalExpression(draft);
    if (value === null) return;
    if (Math.abs(value - cat.budgeted) < 0.005) return;
    onSave(value);
  };

  return (
    <Input
      className="insp-assign-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      type="text"
      inputMode="decimal"
      placeholder="0"
    />
  );
}
