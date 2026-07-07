"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocale } from "@/lib/locale-context";
import { useEvent } from "@/lib/use-events";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CategoryPicker } from "@/components/shared/category-picker";
import { BudgetLinkControl } from "@/components/shared/budget-link-control";
import { Plus, Loader2, Target, Star, Info } from "lucide-react";
import { F } from "@/components/ui/f";

interface SavingsGoal {
  id: number;
  name: string;
  target_amount: number;
  saved_amount: number;
  ynab_category_id: string | null;
  ynab_category_name: string | null;
  target_date: string | null;
  description: string | null;
  include_in_calculations: number;
  is_active: number;
  // Budget link: when derived is true the saved amount comes from the linked category's available
  // balance and the manual field is read-only.
  derived: boolean;
  linked_category_id: number | null;
  linked_category_name: string | null;
  linked_group_name: string | null;
}

// Render free text with http(s) URLs turned into clickable links.
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p)
          ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="goal-desc-link" onClick={(e) => e.stopPropagation()}>{p}</a>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

export default function SavingsGoalsPage() {
  const { t, locale, fmtDate } = useLocale();
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // The editor tracks the goal id; the goal object is derived from the loaded list, so a reload
  // (e.g. after linking/unlinking inside the modal) refreshes the open editor automatically.
  const [editTargetId, setEditTargetId] = useState<number | null>(null);
  const [categories, setCategories] = useState<{ id: number; name: string; group_name: string }[]>([]);
  const addFormRef = useRef<HTMLFormElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);
  // Picker value holds the category name (CategoryPicker selects by name); the id is looked up on
  // save. The edit dialog links/unlinks through BudgetLinkControl instead, immediately.
  const [addCategory, setAddCategory] = useState("");
  const [savedInfoOpen, setSavedInfoOpen] = useState(false);

  const loadGoals = useCallback(() => {
    console.debug("[savings-goals] Loading goals");
    fetch("/api/savings-goals")
      .then((r) => r.json())
      .then((data) => {
        if (data.goals) {
          console.info("[savings-goals] Loaded", data.goals.length, "goals");
          setGoals(data.goals);
        }
      })
      .catch((err) => console.error("[savings-goals] Load error:", err))
      .finally(() => setLoading(false));
  }, []);

  const loadCategories = useCallback(() => {
    fetch("/api/categories").then((r) => r.json()).then((d) => {
      if (Array.isArray(d.categories)) {
        setCategories(
          d.categories
            .filter((c: { is_active: number }) => c.is_active)
            .map((c: { id: number; name: string; group_name: string }) => ({ id: c.id, name: c.name, group_name: c.group_name || "" }))
        );
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadGoals();
    loadCategories();
  }, [loadGoals, loadCategories]);

  useEvent("data:updated", useCallback(() => { loadGoals(); loadCategories(); }, [loadGoals, loadCategories]));


  // Create a new category from the picker and select it. Names are unique, so a duplicate just
  // reuses the existing one (already in the list); a real create is appended for the next open.
  const createCategory = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const d = await res.json();
      if (d.id) {
        console.info("[savings-goals] Created category", trimmed, "id:", d.id);
        setCategories((prev) =>
          [...prev, { id: d.id as number, name: trimmed, group_name: "" }]
            .sort((a, b) => (a.group_name || "").localeCompare(b.group_name || "") || a.name.localeCompare(b.name))
        );
      }
    } catch (err) { console.error("[savings-goals] Create category error:", err); }
  }, []);

  const editTarget = editTargetId != null ? goals.find((g) => g.id === editTargetId) ?? null : null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = addFormRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const cat = categories.find((c) => c.name === addCategory);
    const body = {
      name: fd.get("name") as string,
      target_amount: parseFloat((fd.get("target_amount") as string).replace(",", ".")),
      target_date: (fd.get("target_date") as string) || null,
      description: (fd.get("description") as string) || "",
      ynab_category_id: cat ? String(cat.id) : null,
      ynab_category_name: addCategory || null,
    };
    console.info("[savings-goals] Adding:", body.name);
    try {
      const res = await fetch("/api/savings-goals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.id) {
        setAddOpen(false);
        form.reset();
        setAddCategory("");
        loadGoals();
      }
    } catch (err) { console.error("[savings-goals] Add error:", err); }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editFormRef.current) return;
    const fd = new FormData(editFormRef.current);
    // The budget link is managed by BudgetLinkControl (immediate), so the category fields are
    // deliberately absent here - sending them would clobber a link made moments earlier.
    const body: Record<string, unknown> = {
      id: editTarget.id,
      name: fd.get("name") as string,
      target_amount: parseFloat((fd.get("target_amount") as string).replace(",", ".")),
      target_date: (fd.get("target_date") as string) || null,
      description: (fd.get("description") as string) || "",
    };
    // The saved amount is only writable for unlinked goals: on a derived goal the field is disabled
    // (a disabled input is absent from FormData, and writing 0 over the stored manual value would
    // destroy it for a later unlink).
    if (!editTarget.derived) {
      body.saved_amount = parseFloat((fd.get("saved_amount") as string || "0").replace(",", "."));
    }
    console.info("[savings-goals] Editing:", body.id);
    try {
      await fetch("/api/savings-goals", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setEditOpen(false);
      setEditTargetId(null);
      loadGoals();
    } catch (err) { console.error("[savings-goals] Edit error:", err); }
  };

  const toggleCalculations = async (id: number, current: number) => {
    setGoals((prev) => prev.map((g) => g.id === id ? { ...g, include_in_calculations: current ? 0 : 1 } : g));
    try {
      await fetch("/api/savings-goals", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, include_in_calculations: !current }) });
    } catch (err) { console.error("[savings-goals] Toggle error:", err); }
  };

  const deleteGoal = async (id: number) => {
    console.info("[savings-goals] Deleting:", id);
    try {
      await fetch("/api/savings-goals", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      setGoals((prev) => prev.filter((g) => g.id !== id));
    } catch (err) { console.error("[savings-goals] Delete error:", err); }
  };

  const active = goals.filter((g) => g.is_active);
  const totalTarget = active.reduce((s, g) => s + g.target_amount, 0);
  const totalSaved = active.reduce((s, g) => s + g.saved_amount, 0);
  const overallProgress = totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0;

  // Calculate monthly savings needed
  const calcMonthlySavings = (goal: SavingsGoal) => {
    const remaining = goal.target_amount - goal.saved_amount;
    if (remaining <= 0) return 0;
    if (!goal.target_date) return remaining;
    const target = new Date(goal.target_date);
    const now = new Date();
    const months = Math.max(1, (target.getFullYear() - now.getFullYear()) * 12 + target.getMonth() - now.getMonth());
    return Math.round((remaining / months) * 100) / 100;
  };

  if (loading) {
    return <div className="page-loading"><Loader2 className="page-loading-spinner animate-spin" /></div>;
  }

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <div>
          <h1 className="page-heading">{locale === "fi" ? "Säästökohteet" : "Savings goals"}</h1>
          <p className="page-subtitle">{locale === "fi" ? "Suunnittele ja seuraa säästötavoitteita" : "Plan and track your savings targets"}</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="icon-sm" />
            {locale === "fi" ? "Lisää tavoite" : "Add goal"}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{locale === "fi" ? "Lisää säästötavoite" : "Add savings goal"}</DialogTitle></DialogHeader>
            <form ref={addFormRef} onSubmit={handleAdd} className="form-stack">
              <div className="form-field">
                <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
                <Input name="name" placeholder={locale === "fi" ? "esim. Uusi sohva" : "e.g. New couch"} required />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Tavoite (€)" : "Target (€)"}</Label>
                <Input name="target_amount" type="text" inputMode="decimal" placeholder="0" required />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Tavoitepäivä" : "Target date"}</Label>
                <DateField name="target_date" />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Kategoria" : "Category"}</Label>
                <CategoryPicker
                  value={addCategory}
                  onChange={setAddCategory}
                  categories={categories}
                  placeholder={locale === "fi" ? "Valitse kategoria" : "Select category"}
                  noneLabel={locale === "fi" ? "Ei kategoriaa" : "No category"}
                  searchPlaceholder={locale === "fi" ? "Hae tai luo uusi..." : "Search or create..."}
                  onCreate={createCategory}
                  createLabel={(q) => (locale === "fi" ? `Luo "${q}"` : `Create "${q}"`)}
                />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Kuvaus" : "Description"}</Label>
                <textarea name="description" className="input goal-desc-input" rows={2} placeholder={locale === "fi" ? "Muistiinpanot, linkit..." : "Notes, links..."} />
              </div>
              <Button type="submit">{locale === "fi" ? "Lisää tavoite" : "Add goal"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="page-grid-2-sm">
        <Card className="metric-card">
          <div className="metric-card-row">
            <div className="metric-card-icon" data-color="primary">
              <Target />
            </div>
            <div>
              <p className="metric-card-label">{locale === "fi" ? "Tavoitteet yhteensä" : "Total target"}</p>
              <p className="metric-card-value"><F v={totalTarget} /></p>
              <p className="metric-card-note">{active.length} {locale === "fi" ? "tavoitetta" : "goals"}</p>
            </div>
          </div>
        </Card>
        <Card className="metric-card">
          <div className="metric-card-row">
            <div className="metric-card-icon" data-color="positive">
              <Star />
            </div>
            <div>
              <p className="metric-card-label">{locale === "fi" ? "Säästetty" : "Saved"}</p>
              <p className="metric-card-value"><F v={totalSaved} /></p>
              <p className="metric-card-note">{overallProgress}%</p>
            </div>
          </div>
        </Card>
      </div>

      {active.length > 0 && (
        <Card className="list-card list-card-divider">
          {active.map((goal) => {
            const progress = goal.target_amount > 0 ? Math.round((goal.saved_amount / goal.target_amount) * 100) : 0;
            const monthly = calcMonthlySavings(goal);
            return (
              <div key={goal.id} className="list-item list-item-col">
                <div className="list-item-main" onClick={() => { setEditTargetId(goal.id); setSavedInfoOpen(false); setEditOpen(true); }}>
                  <div className="list-item-body">
                    <div className="list-item-name-row">
                      <p className="list-item-name">{goal.name}</p>
                      {!goal.include_in_calculations && <Badge variant="secondary">{locale === "fi" ? "Ei laskelmissa" : "Excluded"}</Badge>}
                    </div>
                    <p className="list-item-meta">
                      <F v={goal.saved_amount} s="" /> / <F v={goal.target_amount} /> · {progress}%
                      {goal.target_date && ` · ${locale === "fi" ? "tavoite" : "by"} ${fmtDate(goal.target_date)}`}
                      {monthly > 0 && goal.target_date && <> · <F v={monthly} s={` €/${locale === "fi" ? "kk" : "mo"}`} /></>}
                      {(goal.linked_category_name || goal.ynab_category_name) && ` · ${goal.linked_category_name || goal.ynab_category_name}`}
                    </p>
                    {goal.description && <p className="goal-desc"><Linkify text={goal.description} /></p>}
                    <Progress value={progress} className="progress-thin" />
                  </div>
                  <div className="list-item-end">
                    <p className="list-item-amount-value"><F v={goal.target_amount} /></p>
                    <span onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={!!goal.include_in_calculations}
                        onCheckedChange={() => toggleCalculations(goal.id, goal.include_in_calculations)}
                      />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {goals.length === 0 && (
        <p className="page-subtitle">{locale === "fi" ? "Ei vielä säästötavoitteita. Lisää ensimmäinen!" : "No savings goals yet. Add your first one!"}</p>
      )}

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditTargetId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "fi" ? "Muokkaa tavoitetta" : "Edit goal"}</DialogTitle></DialogHeader>
          {editTarget && (
            <form ref={editFormRef} onSubmit={handleEdit} className="form-stack">
              <div className="form-field">
                <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
                <Input name="name" defaultValue={editTarget.name} required />
              </div>
              <div className="form-grid-2">
                <div className="form-field">
                  <Label>{locale === "fi" ? "Tavoite (€)" : "Target (€)"}</Label>
                  <Input name="target_amount" type="text" inputMode="decimal" defaultValue={editTarget.target_amount} required />
                </div>
                <div className="form-field">
                  <Label className="metric-card-label-info">
                    {locale === "fi" ? "Säästetty (€)" : "Saved (€)"}
                    {editTarget.derived && (
                      <span className={`metric-info-wrap ${savedInfoOpen ? "is-open" : ""}`}>
                        <button type="button" className="metric-info-trigger" onClick={() => setSavedInfoOpen((v) => !v)}>
                          <Info />
                        </button>
                        <span className="metric-info-popup">
                          {locale === "fi"
                            ? "Lasketaan automaattisesti linkitetystä budjettikategoriasta"
                            : "Derived automatically from the linked budget category"}
                        </span>
                      </span>
                    )}
                  </Label>
                  <Input name="saved_amount" type="text" inputMode="decimal" defaultValue={editTarget.saved_amount} disabled={editTarget.derived} />
                </div>
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Tavoitepäivä" : "Target date"}</Label>
                <DateField name="target_date" defaultValue={editTarget.target_date || ""} />
              </div>
              <BudgetLinkControl linkType="savings_goal" targetId={editTarget.id} />
              <div className="form-field">
                <Label>{locale === "fi" ? "Kuvaus" : "Description"}</Label>
                <textarea name="description" className="input goal-desc-input" rows={2} defaultValue={editTarget.description || ""} placeholder={locale === "fi" ? "Muistiinpanot, linkit..." : "Notes, links..."} />
              </div>
              <div className="form-grid-2">
                <Button type="button" variant="destructive" onClick={() => { deleteGoal(editTarget.id); setEditOpen(false); }}>
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
