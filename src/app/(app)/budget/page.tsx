"use client";

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
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
import { ChevronLeft, ChevronRight, ChevronDown, Loader2, Plus, GripVertical, EyeOff, Eye, ArrowRightLeft, Moon, Trash2 } from "lucide-react";
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
  description: string;
  is_active: number;
  snoozed: number;
  budgeted: number;
  activity: number;
  carryover: number;
  available: number;
  target_monthly: number;
  target_amount: number;
  target_cadence: string;
  snooze_until_month: string;
  target_active: boolean;
}

interface BudgetData {
  month: string;
  categories: BudgetCategory[];
  income: number;
  totalBudgeted: number;
  readyToAssign: number;
  ageOfMoney: number | null;
  ageOfMoneyHistory: { month: string; age: number }[];
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

// Half a display step: a value within this of zero rounds to "0", so it should read as
// fully assigned, not overspent. Keeps state in sync with the shown precision.
function availEps(decimals: number): number {
  return decimals >= 2 ? 0.005 : 0.5 / Math.pow(10, decimals);
}

const CADENCES = ["daily", "weekly", "monthly", "yearly"] as const;

function cadenceLabel(cadence: string, locale: string): string {
  const fi: Record<string, string> = { daily: "Päivä", weekly: "Viikko", monthly: "Kuukausi", yearly: "Vuosi" };
  const en: Record<string, string> = { daily: "Day", weekly: "Week", monthly: "Month", yearly: "Year" };
  return (locale === "fi" ? fi : en)[cadence] || cadence;
}

function cadenceSuffix(cadence: string, locale: string): string {
  const fi: Record<string, string> = { daily: "/ pv", weekly: "/ vko", monthly: "/ kk", yearly: "/ v" };
  const en: Record<string, string> = { daily: "/ day", weekly: "/ wk", monthly: "/ mo", yearly: "/ yr" };
  return (locale === "fi" ? fi : en)[cadence] || "";
}

// Monthly-equivalent of a target amount at a cadence (mirrors lib/budget-math).
function targetMonthlyEq(amount: number, cadence: string, month: string): number {
  const [y, m] = month.split("-").map(Number);
  const dim = new Date(y, m, 0).getDate();
  const round = (n: number) => Math.round(n * 100) / 100;
  switch (cadence) {
    case "daily": return round(amount * dim);
    case "weekly": return round(amount * (dim / 7));
    case "yearly": return round(amount / 12);
    default: return round(amount);
  }
}

export default function BudgetPage() {
  const { locale, fmt, decimals } = useLocale();
  const eps = availEps(decimals);
  const [month, setMonth] = useState<string>(thisMonth());
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [inspectorId, setInspectorId] = useState<number | null>(null);
  const [catSaved, setCatSaved] = useState(false);
  const [targetEditing, setTargetEditing] = useState(false);
  const [targetDraft, setTargetDraft] = useState<string>("");
  const [targetCadence, setTargetCadence] = useState<string>("monthly");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDir, setMoveDir] = useState<"in" | "out">("out");
  const [moveOther, setMoveOther] = useState<string>("");
  const [moveDraft, setMoveDraft] = useState<string>("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteDest, setDeleteDest] = useState<string>("rta");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [localGroups, setLocalGroups] = useState<{ key: string; label: string; items: BudgetCategory[] }[]>([]);
  const [bdrag, setBdrag] = useState<{ type: "row" | "group"; id: number | string; fromGroup: string } | null>(null);
  const [dropAt, setDropAt] = useState<{ groupKey: string; index: number } | null>(null);
  const [dropGroupAt, setDropGroupAt] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [filter, setFilter] = useState<"all" | "overspent" | "available">("all");
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoAmounts, setAutoAmounts] = useState<{ underfunded: number; last_assigned: number; last_spent: number } | null>(null);
  const addCatRef = useRef<HTMLFormElement>(null);

  const inspectorCat = inspectorId !== null ? (data?.categories.find((c) => c.id === inspectorId) ?? null) : null;
  const closeInspector = () => {
    setInspectorId(null);
    setTargetEditing(false);
    setTargetDraft("");
    setMoveOpen(false);
    setMoveOther("");
    setMoveDraft("");
    setDeleteOpen(false);
    setDeleteDest("rta");
  };

  // Reset the per-category panels when switching to another category in the inspector
  useEffect(() => {
    setMoveOpen(false);
    setMoveOther("");
    setMoveDraft("");
    setDeleteOpen(false);
    setDeleteDest("rta");
  }, [inspectorId]);

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
      if (!c.is_active || c.snoozed) continue;
      const key = c.group_name || "";
      if (!map.has(key)) map.set(key, { key, label: key || (locale === "fi" ? "Muut" : "Other"), items: [] });
      map.get(key)!.items.push(c);
    }
    setLocalGroups([...map.values()]);
  }, [data, locale]);

  // Drag-and-drop reorder inside the budget view. The layout never reshuffles during a
  // drag: the source row dims and a single dashed placeholder marks the drop position.
  // The reorder (and any cross-group move) is committed only on drop.
  const persistOrderAndGroups = (groups: typeof localGroups) => {
    const items = groups.flatMap((g) => g.items.map((c) => ({ id: c.id, group_name: g.key })));
    fetch("/api/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }).then(() => load(month)).catch(() => {});
    console.info("[budget] Saved row order and group membership");
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

  const clearDrag = () => { setBdrag(null); setDropAt(null); setDropGroupAt(null); };

  const onRowDragStart = (e: React.DragEvent, groupKey: string, id: number) => {
    setBdrag({ type: "row", id, fromGroup: groupKey });
    setDropAt(null);
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(id)); } catch {}
  };

  const onRowDragOver = (e: React.DragEvent, groupKey: string, rIdx: number) => {
    if (!bdrag || bdrag.type !== "row") return;
    e.preventDefault();
    e.stopPropagation();
    try { e.dataTransfer.dropEffect = "move"; } catch {}
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const index = rIdx + (after ? 1 : 0);
    setDropAt((prev) => (prev && prev.groupKey === groupKey && prev.index === index ? prev : { groupKey, index }));
  };

  // Hovering a group card but not a specific row (header, gaps, empty group): drop at the end.
  const onGroupBodyDragOver = (e: React.DragEvent, groupKey: string, count: number) => {
    if (!bdrag || bdrag.type !== "row") return;
    e.preventDefault();
    setDropAt((prev) => (prev && prev.groupKey === groupKey ? prev : { groupKey, index: count }));
  };

  const onGroupDragStart = (e: React.DragEvent, key: string) => {
    setBdrag({ type: "group", id: key, fromGroup: key });
    setDropGroupAt(null);
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); } catch {}
  };

  const onGroupDragOver = (e: React.DragEvent, gIdx: number) => {
    if (!bdrag || bdrag.type !== "group") return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const index = gIdx + (after ? 1 : 0);
    setDropGroupAt((prev) => (prev === index ? prev : index));
  };

  const commitRowDrop = () => {
    if (!bdrag || bdrag.type !== "row" || !dropAt) return clearDrag();
    const next = localGroups.map((g) => ({ ...g, items: [...g.items] }));
    let dragged: BudgetCategory | undefined;
    let removedBelowTarget = false;
    for (const g of next) {
      const i = g.items.findIndex((c) => c.id === bdrag.id);
      if (i !== -1) {
        dragged = g.items[i];
        if (g.key === dropAt.groupKey && i < dropAt.index) removedBelowTarget = true;
        g.items.splice(i, 1);
        break;
      }
    }
    const tg = next.find((g) => g.key === dropAt.groupKey);
    if (!dragged || !tg) return clearDrag();
    let idx = dropAt.index - (removedBelowTarget ? 1 : 0);
    idx = Math.max(0, Math.min(idx, tg.items.length));
    tg.items.splice(idx, 0, { ...dragged, group_name: tg.key });
    setLocalGroups(next);
    persistOrderAndGroups(next);
    clearDrag();
  };

  const commitGroupDrop = () => {
    if (!bdrag || bdrag.type !== "group" || dropGroupAt === null) return clearDrag();
    const fromIdx = localGroups.findIndex((g) => g.key === bdrag.id);
    if (fromIdx === -1) return clearDrag();
    const next = [...localGroups];
    const [moved] = next.splice(fromIdx, 1);
    let toIdx = dropGroupAt - (fromIdx < dropGroupAt ? 1 : 0);
    toIdx = Math.max(0, Math.min(toIdx, next.length));
    next.splice(toIdx, 0, moved);
    setLocalGroups(next);
    persistGroupOrder(next);
    clearDrag();
  };

  const onBudgetDrop = (e: React.DragEvent) => {
    if (!bdrag) return;
    e.preventDefault();
    if (bdrag.type === "row") commitRowDrop();
    else commitGroupDrop();
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
        body: JSON.stringify({ category_id: inspectorCat.id, monthly_amount: value, cadence: targetCadence }),
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

  const saveCategoryFields = async (id: number, fields: { name?: string; group_name?: string; description?: string }) => {
    try {
      await fetch("/api/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...fields }),
      });
      setCatSaved(true);
      setTimeout(() => setCatSaved(false), 1800);
      load(month);
    } catch (err) {
      console.error("[budget] Save category error:", err);
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

  // Move available money OUT of a category to another category, or back to Ready to Assign
  const moveOut = async (cat: BudgetCategory, dest: number | "rta", amount: number) => {
    if (!(amount > 0)) return;
    if (dest === "rta") {
      await saveBudgeted(cat.id, Math.round((cat.budgeted - amount) * 100) / 100);
    } else {
      await moveMoney(cat.id, dest, amount);
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

  const snoozeCategory = async (id: number, on: boolean) => {
    try {
      await fetch("/api/budget/snooze", {
        method: on ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: id, month }),
      });
      load(month);
    } catch (err) {
      console.error("[budget] Snooze category error:", err);
    }
  };

  // Delete a category. Any leftover available money is moved out first (back to Ready to
  // Assign or into another category), and an overspent category is covered first, so no
  // money is orphaned. dest: "rta" | another category id.
  const deleteCategory = async (c: BudgetCategory, dest: number | "rta") => {
    try {
      const avail = c.available;
      if (avail > eps) {
        if (dest === "rta") {
          await fetch("/api/budget", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month, category_id: c.id, budgeted: Math.round((c.budgeted - avail) * 100) / 100 }),
          });
        } else {
          await fetch("/api/budget/move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month, from_category_id: c.id, to_category_id: dest, amount: avail }),
          });
        }
      } else if (avail < -eps && typeof dest === "number") {
        await fetch("/api/budget/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month, from_category_id: dest, to_category_id: c.id, amount: Math.round(-avail * 100) / 100 }),
        });
      }
      await fetch("/api/categories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id }),
      });
      setDeleteOpen(false);
      setDeleteDest("rta");
      setInspectorId(null);
      load(month);
    } catch (err) {
      console.error("[budget] Delete category error:", err);
    }
  };

  // Preview how much each auto-assign mode would assign (already capped at Ready to Assign)
  const loadAutoAmounts = async () => {
    setAutoAmounts(null);
    try {
      const d = await (await fetch(`/api/budget/auto-assign?month=${month}`)).json();
      setAutoAmounts({ underfunded: d.underfunded ?? 0, last_assigned: d.last_assigned ?? 0, last_spent: d.last_spent ?? 0 });
    } catch {
      setAutoAmounts({ underfunded: 0, last_assigned: 0, last_spent: 0 });
    }
  };

  // Auto-assign (YNAB Quick Budget): fund to targets, copy last month's assigned, or last month's spending
  const autoAssign = async (mode: "underfunded" | "last_assigned" | "last_spent") => {
    try {
      await fetch("/api/budget/auto-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, mode }),
      });
      setAutoOpen(false);
      load(month);
    } catch (err) {
      console.error("[budget] Auto-assign error:", err);
    }
  };

  // Delete a group: move all its categories to "no group" (categories are kept, the grouping
  // is removed). Groups are derived from category group_name, so emptying it removes it.
  const deleteGroup = async (groupKey: string) => {
    try {
      const ids = (data?.categories || []).filter((c) => (c.group_name || "") === groupKey).map((c) => c.id);
      await Promise.all(ids.map((id) =>
        fetch("/api/categories", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, group_name: "" }) })
      ));
      load(month);
    } catch (err) {
      console.error("[budget] Delete group error:", err);
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
        {(() => {
          const rta = data?.readyToAssign || 0;
          const state = rta > eps ? "is-positive" : rta < -eps ? "is-negative" : "is-zero";
          const label = state === "is-zero"
            ? (locale === "fi" ? "Kaikki budjetoitu" : "All assigned")
            : state === "is-negative"
            ? (locale === "fi" ? "Liikaa budjetoitu" : "Over-assigned")
            : (locale === "fi" ? "Budjetoimatta" : "Ready to assign");
          return (
            <div className="budget-center">
              <div className="budget-ready-wrap">
                <button
                  type="button"
                  className={`budget-ready-box ${state} budget-ready-btn`}
                  onClick={() => { const open = !autoOpen; setAutoOpen(open); if (open) loadAutoAmounts(); }}
                  aria-haspopup="menu"
                  aria-expanded={autoOpen}
                >
                  <span className="budget-ready-col">
                    <span className="budget-ready-value"><F v={rta} s=" €" /></span>
                    <span className="budget-ready-label">{label}</span>
                  </span>
                  <ChevronDown className="budget-ready-caret" />
                </button>
                {autoOpen && (
                  <>
                    <div className="budget-autoassign-backdrop" onClick={() => setAutoOpen(false)} />
                    <div className="budget-autoassign-menu budget-assign-menu">
                      {([
                        ["underfunded", locale === "fi" ? "Tavoitteet täyteen" : "Fund to targets"],
                        ["last_assigned", locale === "fi" ? "Kuten viime kuussa" : "Assigned last month"],
                        ["last_spent", locale === "fi" ? "Viime kuun toteuma" : "Spent last month"],
                      ] as const).map(([mode, lbl]) => {
                        const amt = autoAmounts?.[mode] ?? null;
                        const disabled = amt !== null && amt <= 0;
                        return (
                          <button key={mode} type="button" disabled={disabled} onClick={() => autoAssign(mode)}>
                            <span>{lbl}</span>
                            <span className="budget-autoassign-amt">{amt !== null ? <F v={amt} s=" €" /> : "…"}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              {data?.ageOfMoney != null && (
                <div className="budget-aom-box" title={locale === "fi" ? "Kauanko rahasi riittää nykyisellä kulutuksella" : "How long your money lasts at the current spending rate"}>
                  <span className="budget-ready-value">{data.ageOfMoney} {locale === "fi" ? "pv" : "days"}</span>
                  <span className="budget-ready-label">{locale === "fi" ? "Rahan ikä" : "Age of money"}</span>
                </div>
              )}
            </div>
          );
        })()}
        <button type="button" className="budget-manage-btn" onClick={() => setAddCatOpen(true)} aria-label={locale === "fi" ? "Lisää kategoria" : "Add category"}>
          <Plus />
        </button>
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

      <div
        className={`budget-table ${bdrag ? "is-reordering" : ""}`}
        onDragOver={bdrag ? (e) => e.preventDefault() : undefined}
        onDrop={bdrag ? onBudgetDrop : undefined}
      >
      <div className="budget-grid budget-table-header">
        <span>{locale === "fi" ? "Kategoria" : "Category"}</span>
        <span>{locale === "fi" ? "Budjetoitu" : "Assigned"}</span>
        <span className="budget-col-activity">{locale === "fi" ? "Toteuma" : "Activity"}</span>
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
        const draggingRow = bdrag?.type === "row";
        const isGroupGhost = bdrag?.type === "group" && bdrag.id === group.key;
        const rowDropHere = draggingRow && dropAt?.groupKey === group.key;
        return (
          <Fragment key={group.key}>
            {bdrag?.type === "group" && dropGroupAt === gIdx && <div className="budget-group-drop-line" aria-hidden="true" />}
            <Card
              className={`list-card list-card-divider ${isGroupGhost ? "is-drag-ghost" : ""}`}
              onDragOver={dragEnabled ? (e) => (bdrag?.type === "group" ? onGroupDragOver(e, gIdx) : onGroupBodyDragOver(e, group.key, visibleItems.length)) : undefined}
            >
              <div
                className="budget-grid budget-group-header"
                draggable={dragEnabled}
                onDragStart={dragEnabled ? (e) => onGroupDragStart(e, group.key) : undefined}
                onDragEnd={dragEnabled ? clearDrag : undefined}
              >
                {dragEnabled && <span className="budget-grip budget-group-grip" aria-hidden="true"><GripVertical /></span>}
                <span className="budget-group-name">
                  <span className="budget-group-label">{group.label}</span>
                  {dragEnabled && group.key && (
                    <button
                      type="button"
                      className="budget-group-delete"
                      draggable={false}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        const msg = locale === "fi"
                          ? `Poistetaanko ryhmä "${group.label}"? Sen ${items.length} kategoriaa säilyvät ryhmättöminä.`
                          : `Delete group "${group.label}"? Its ${items.length} categories are kept, without a group.`;
                        if (window.confirm(msg)) deleteGroup(group.key);
                      }}
                      aria-label={locale === "fi" ? "Poista ryhmä" : "Delete group"}
                    >
                      <Trash2 />
                    </button>
                  )}
                </span>
                <span className="budget-num"><F v={groupBudgeted} /></span>
                <span className="budget-num text-muted budget-col-activity"><F v={groupActivity} /></span>
                <span className="budget-num">
                  <span className={`budget-pill ${groupAvailable > eps ? "is-positive" : groupAvailable < -eps ? "is-negative" : "is-zero"}`}>
                    <F v={groupAvailable} />
                  </span>
                </span>
              </div>
              {visibleItems.map((c, rIdx) => {
                const isRowGhost = draggingRow && bdrag!.id === c.id;
                return (
                  <Fragment key={c.id}>
                    {rowDropHere && dropAt!.index === rIdx && <div className="budget-drop-line" aria-hidden="true" />}
                    <div
                      className={`budget-row-drag ${isRowGhost ? "is-drag-ghost" : ""}`}
                      onDragOver={dragEnabled ? (e) => onRowDragOver(e, group.key, rIdx) : undefined}
                    >
                      {dragEnabled && (
                        <button
                          type="button"
                          className="budget-grip budget-row-grip"
                          draggable
                          onDragStart={(e) => onRowDragStart(e, group.key, c.id)}
                          onDragEnd={clearDrag}
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
                        onMoveOut={(dest, amount) => moveOut(c, dest, amount)}
                      />
                    </div>
                  </Fragment>
                );
              })}
              {rowDropHere && dropAt!.index >= visibleItems.length && <div className="budget-drop-line" aria-hidden="true" />}
            </Card>
          </Fragment>
        );
      })}
      {bdrag?.type === "group" && dropGroupAt === localGroups.length && <div className="budget-group-drop-line" aria-hidden="true" />}

      {(() => {
        const snoozedCats = (data?.categories || []).filter((c) => c.is_active && c.snoozed);
        if (snoozedCats.length === 0) return null;
        return (
          <Card className="list-card list-card-divider">
            <button type="button" className="budget-hidden-toggle" onClick={() => setShowSnoozed((s) => !s)}>
              <ChevronDown className={`budget-hidden-chevron ${showSnoozed ? "is-open" : ""}`} />
              <span>{locale === "fi" ? "Torkutetut tälle kuulle" : "Snoozed this month"}</span>
              <span className="budget-hidden-count">{snoozedCats.length}</span>
            </button>
            {showSnoozed && snoozedCats.map((c) => (
              <button key={c.id} type="button" className="budget-hidden-row" onClick={() => setInspectorId(c.id)}>
                <span className="budget-hidden-name">{c.name}</span>
                {c.group_name && <span className="budget-hidden-group">{c.group_name}</span>}
              </button>
            ))}
          </Card>
        );
      })()}

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
            const availState = c.available > eps ? "is-positive" : c.available < -eps ? "is-negative" : "is-zero";
            const hasTarget = c.target_monthly > 0;
            const isSnoozed = hasTarget && c.snooze_until_month >= month;
            const progress = hasTarget ? Math.min(1, c.budgeted / c.target_monthly) : 0;
            return (
              <>
                <SheetHeader className="insp-header">
                  <SheetTitle className="sr-only">{c.name}</SheetTitle>
                  <input
                    key={`name-${c.id}`}
                    className="insp-name-input"
                    defaultValue={c.name}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) saveCategoryFields(c.id, { name: v }); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    aria-label={locale === "fi" ? "Kategorian nimi" : "Category name"}
                  />
                  <input
                    key={`group-${c.id}`}
                    className="insp-group-input"
                    defaultValue={c.group_name}
                    placeholder={locale === "fi" ? "Ryhmä" : "Group"}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== c.group_name) saveCategoryFields(c.id, { group_name: v }); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    aria-label={locale === "fi" ? "Ryhmä" : "Group"}
                  />
                  <textarea
                    key={`desc-${c.id}`}
                    className="insp-desc-input"
                    defaultValue={c.description}
                    placeholder={locale === "fi" ? "Kuvaus (valinnainen)" : "Description (optional)"}
                    rows={2}
                    onBlur={(e) => { if (e.target.value !== c.description) saveCategoryFields(c.id, { description: e.target.value }); }}
                    aria-label={locale === "fi" ? "Kuvaus" : "Description"}
                  />
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
                        <div className="insp-target-row">
                          <Input value={targetDraft} onChange={(e) => setTargetDraft(e.target.value)} placeholder="0.00" inputMode="decimal" autoFocus className="insp-target-amount" />
                          <Select value={targetCadence} onValueChange={(v) => v && setTargetCadence(v)}>
                            <SelectTrigger className="insp-target-cadence"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CADENCES.map((cad) => (
                                <SelectItem key={cad} value={cad}>{cadenceLabel(cad, locale)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <p className="settings-help">
                          {targetCadence === "monthly"
                            ? (locale === "fi" ? "Summa, joka varataan tälle joka kuukausi." : "Amount assigned here every month.")
                            : (() => {
                                const amt = evalExpression(targetDraft) || 0;
                                const eq = targetMonthlyEq(amt, targetCadence, month);
                                return locale === "fi" ? `Jaetaan kuukausille: noin ${fmt(eq)} € / kk.` : `Spread across months: about ${fmt(eq)} € / mo.`;
                              })()}
                        </p>
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
                          {isSnoozed ? (locale === "fi" ? "Tauolla tässä kuussa" : "Paused this month") : (
                            <>
                              <F v={c.target_amount} s=" €" /> {cadenceSuffix(c.target_cadence, locale)}
                              {c.target_cadence !== "monthly" && <span className="text-muted"> · <F v={c.target_monthly} s=" €" /> {cadenceSuffix("monthly", locale)}</span>}
                            </>
                          )}
                        </p>
                        <div className="insp-actions">
                          <Button type="button" variant="outline" size="sm" onClick={() => { setTargetDraft(c.target_amount ? fmt(c.target_amount) : ""); setTargetCadence(c.target_cadence || "monthly"); setTargetEditing(true); }}>{locale === "fi" ? "Muokkaa" : "Edit"}</Button>
                          {isSnoozed ? (
                            <Button type="button" variant="outline" size="sm" onClick={() => unsnoozeTarget(c.id)}>{locale === "fi" ? "Jatka" : "Resume"}</Button>
                          ) : (
                            <Button type="button" variant="outline" size="sm" onClick={() => snoozeTarget(c.id)}>{locale === "fi" ? "Tauota" : "Snooze"}</Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => { setTargetDraft(""); setTargetCadence("monthly"); setTargetEditing(true); }}>{locale === "fi" ? "Aseta tavoite" : "Set a target"}</Button>
                    )}
                  </div>

                  {(() => {
                    const others = (data?.categories || []).filter((o) => o.is_active && o.id !== c.id);
                    if (others.length === 0) return null;
                    const dirIn = moveDir === "in";
                    const dirLabel = dirIn
                      ? (locale === "fi" ? "Mistä siirretään" : "Move from")
                      : (locale === "fi" ? "Mihin siirretään" : "Move to");
                    return (
                      <div className="insp-section">
                        <span className="insp-section-title">{locale === "fi" ? "Siirrä rahaa" : "Move money"}</span>
                        {moveOpen ? (
                          <div className="insp-move">
                            <div className="insp-move-dir">
                              <button type="button" className="insp-move-swap" onClick={() => setMoveDir(dirIn ? "out" : "in")} aria-label={locale === "fi" ? "Vaihda suunta" : "Switch direction"}>
                                <ArrowRightLeft />
                              </button>
                              <span className="insp-move-dir-label">{dirLabel}</span>
                            </div>
                            <Select value={moveOther} onValueChange={(v) => v && setMoveOther(v)}>
                              <SelectTrigger className="insp-move-select">
                                <SelectValue placeholder={dirLabel} />
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
                                if (dirIn) moveMoney(other, c.id, amt);
                                else moveMoney(c.id, other, amt);
                              }}>{locale === "fi" ? "Siirrä" : "Move"}</Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => { setMoveOpen(false); setMoveOther(""); setMoveDraft(""); }}>{locale === "fi" ? "Peruuta" : "Cancel"}</Button>
                            </div>
                          </div>
                        ) : (
                          <Button type="button" variant="outline" size="sm" onClick={() => { setMoveOpen(true); setMoveDir(c.available < -eps ? "in" : "out"); setMoveDraft(fmt(Math.abs(c.available))); }}>
                            <ArrowRightLeft className="icon-sm" />
                            {locale === "fi" ? "Siirrä rahaa" : "Move money"}
                          </Button>
                        )}
                      </div>
                    );
                  })()}

                  <div className="insp-section insp-section-end">
                    <Button type="button" variant="ghost" size="sm" className="insp-hide" onClick={() => snoozeCategory(c.id, !c.snoozed)}>
                      <Moon className="icon-sm" />{c.snoozed ? (locale === "fi" ? "Poista torkku tältä kuulta" : "Unsnooze this month") : (locale === "fi" ? "Torkuta kategoria tälle kuulle" : "Snooze for this month")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="insp-hide" onClick={() => toggleActive(c)}>
                      {c.is_active ? <><EyeOff className="icon-sm" />{locale === "fi" ? "Piilota kategoria" : "Hide category"}</> : <><Eye className="icon-sm" />{locale === "fi" ? "Näytä kategoria" : "Unhide category"}</>}
                    </Button>
                    {deleteOpen ? (
                      <div className="insp-delete">
                        {c.available > eps && (
                          <>
                            <span className="insp-delete-note">{locale === "fi" ? `Kategoriassa on ${fmt(c.available)} €. Mihin se siirretään?` : `This category holds ${fmt(c.available)} €. Move it where?`}</span>
                            <Select value={deleteDest} onValueChange={(v) => v && setDeleteDest(v)}>
                              <SelectTrigger className="insp-move-select"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="rta">{locale === "fi" ? "Budjetoimatta" : "Ready to Assign"}</SelectItem>
                                {(data?.categories || []).filter((o) => o.is_active && o.id !== c.id).map((o) => (
                                  <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </>
                        )}
                        {c.available < -eps && (
                          <>
                            <span className="insp-delete-note">{locale === "fi" ? `Kategoria on ylitetty ${fmt(Math.abs(c.available))} €. Mistä kate otetaan?` : `Overspent by ${fmt(Math.abs(c.available))} €. Cover it from where?`}</span>
                            <Select value={deleteDest === "rta" ? "" : deleteDest} onValueChange={(v) => v && setDeleteDest(v)}>
                              <SelectTrigger className="insp-move-select"><SelectValue placeholder={locale === "fi" ? "Valitse kategoria" : "Pick a category"} /></SelectTrigger>
                              <SelectContent>
                                {(data?.categories || []).filter((o) => o.is_active && o.id !== c.id && o.available > eps).map((o) => (
                                  <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </>
                        )}
                        <div className="insp-actions">
                          <Button type="button" variant="destructive" size="sm" disabled={c.available < -eps && (deleteDest === "rta" || !deleteDest)} onClick={() => deleteCategory(c, deleteDest === "rta" ? "rta" : Number(deleteDest))}>
                            {locale === "fi" ? "Poista" : "Delete"}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => { setDeleteOpen(false); setDeleteDest("rta"); }}>{locale === "fi" ? "Peruuta" : "Cancel"}</Button>
                        </div>
                      </div>
                    ) : (
                      <Button type="button" variant="ghost" size="sm" className="insp-hide insp-delete-btn" onClick={() => { setDeleteOpen(true); setDeleteDest("rta"); }}>
                        <Trash2 className="icon-sm" />{locale === "fi" ? "Poista kategoria" : "Delete category"}
                      </Button>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      <div className={`budget-toast ${catSaved ? "is-shown" : ""}`} role="status" aria-live="polite">
        {locale === "fi" ? "Tallennettu" : "Saved"}
      </div>
    </div>
  );
}

function BudgetRow({ cat, saving, onSave, onOpen, fmt, month, locale, siblings, readyToAssign, onCover, onMoveOut }: {
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
  onMoveOut: (dest: number | "rta", amount: number) => void;
}) {
  const [draft, setDraft] = useState<string>(cat.budgeted ? fmt(cat.budgeted) : "");
  const [invalid, setInvalid] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [moveOutOpen, setMoveOutOpen] = useState(false);
  const [moveOutAmount, setMoveOutAmount] = useState("");
  const [focused, setFocused] = useState(false);
  const [actOpen, setActOpen] = useState(false);
  const [actTxns, setActTxns] = useState<{ id: string; date: string; payee: string; amount: number; memo: string | null }[] | null>(null);
  const [actLoading, setActLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { fmtDate, decimals } = useLocale();
  const eps = availEps(decimals);

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
  const pillClass = cat.available < -eps
    ? "is-negative"
    : underfunded
    ? "is-underfunded"
    : cat.available > eps
    ? "is-positive"
    : "is-zero";

  return (
    <div className="budget-grid budget-row">
      <button type="button" className="budget-row-main" onClick={onOpen}>
        <span className="budget-row-nameline">
          <span className="budget-row-name">{cat.name}</span>
          {cat.description && <span className="budget-row-desc">{cat.description}</span>}
        </span>
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
      <span className="budget-num text-muted budget-activity-cell budget-col-activity">
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
        {cat.available < -eps ? (
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
        ) : cat.available > eps ? (
          <>
            <button type="button" className={`budget-pill ${pillClass} budget-pill-btn`} onClick={() => { setMoveOutAmount(fmt(cat.available)); setMoveOutOpen((o) => !o); }} aria-label={locale === "fi" ? "Siirrä rahaa kategoriaan" : "Move money to a category"} aria-haspopup="menu" aria-expanded={moveOutOpen}>
              <F v={cat.available} />
            </button>
            {moveOutOpen && (() => {
              const dests = siblings.filter((o) => o.is_active && o.id !== cat.id);
              const amt = evalExpression(moveOutAmount) ?? 0;
              return (
                <>
                  <div className="budget-calc-backdrop" onClick={() => setMoveOutOpen(false)} />
                  <div className="budget-cover-popover">
                    <div className="budget-cover-title">{locale === "fi" ? "Siirrä kategoriaan:" : "Move to category:"}</div>
                    <Input className="budget-moveout-amount" value={moveOutAmount} onChange={(e) => setMoveOutAmount(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label={locale === "fi" ? "Summa" : "Amount"} />
                    <div className="budget-cover-list">
                      <button type="button" className="budget-cover-item" onClick={() => { if (amt > 0) onMoveOut("rta", amt); setMoveOutOpen(false); }}>
                        <span className="budget-cover-name">{locale === "fi" ? "Budjetoimatta" : "Ready to assign"}</span>
                      </button>
                      {dests.map((o) => (
                        <button key={o.id} type="button" className="budget-cover-item" onClick={() => { if (amt > 0) onMoveOut(o.id, amt); setMoveOutOpen(false); }}>
                          <span className="budget-cover-name">{o.name}</span>
                          <span className="budget-cover-src"><F v={o.available} s=" €" /></span>
                        </button>
                      ))}
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
