"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { resolveDayThisMonth } from "@/lib/date-utils";
import { useLocale } from "@/lib/locale-context";
import { useEvent } from "@/lib/use-events";
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
import { Plus, Loader2, Check, AlertCircle, X } from "lucide-react";
import { F } from "@/components/ui/f";
import { getBrandConfig, BrandIcon } from "@/lib/brands";


interface Subscription {
  id: number;
  name: string;
  amount: number;
  due_day: number;
  brand_color: string;
  brand_logo: string;
  brand_svg?: string;
  is_active: number;
  is_paid: boolean;
  is_overdue: boolean;
  is_priority: number;
  patterns: { id: number; pattern: string }[];
}

export default function SubscriptionsPage() {
  const { locale } = useLocale();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Subscription | null>(null);
  const [newPattern, setNewPattern] = useState("");
  const addFormRef = useRef<HTMLFormElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);

  const loadSubscriptions = useCallback(() => {
    console.debug("[subscriptions] Loading");
    fetch("/api/subscriptions")
      .then((r) => r.json())
      .then((data) => {
        if (data.subscriptions) {
          console.info("[subscriptions] Loaded", data.subscriptions.length);
          setSubscriptions(data.subscriptions);
        }
      })
      .catch((err) => console.error("[subscriptions] Load error:", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadSubscriptions(); }, [loadSubscriptions]);
  useEvent("data:updated", useCallback(() => { loadSubscriptions(); }, [loadSubscriptions]));
  useEvent("sync:complete", useCallback(() => { loadSubscriptions(); }, [loadSubscriptions]));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = addFormRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const name = fd.get("name") as string;
    const brand = getBrandConfig(name);
    const body = {
      name,
      amount: parseFloat((fd.get("amount") as string).replace(",", ".")),
      due_day: parseInt(fd.get("due_day") as string, 10),
      brand_color: brand.color,
      brand_logo: brand.logo,
    };
    console.info("[subscriptions] Adding:", body.name);
    try {
      const res = await fetch("/api/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if ((await res.json()).id) {
        setAddOpen(false);
        form.reset();
        loadSubscriptions();
      }
    } catch (err) { console.error("[subscriptions] Add error:", err); }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editFormRef.current) return;
    const fd = new FormData(editFormRef.current);
    const name = fd.get("name") as string;
    const brand = getBrandConfig(name);
    const body = {
      id: editTarget.id,
      name,
      amount: parseFloat((fd.get("amount") as string).replace(",", ".")),
      due_day: parseInt(fd.get("due_day") as string, 10),
      brand_color: brand.color,
      brand_logo: brand.logo,
    };
    console.info("[subscriptions] Editing:", body.id);
    try {
      await fetch("/api/subscriptions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setEditOpen(false);
      setEditTarget(null);
      loadSubscriptions();
    } catch (err) { console.error("[subscriptions] Edit error:", err); }
  };

  const toggleSub = async (id: number, currentActive: number) => {
    setSubscriptions((prev) => prev.map((s) => s.id === id ? { ...s, is_active: currentActive ? 0 : 1 } : s));
    try {
      await fetch("/api/subscriptions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, is_active: !currentActive }) });
    } catch (err) { console.error("[subscriptions] Toggle error:", err); }
  };

  const deleteSub = async (id: number) => {
    console.info("[subscriptions] Deleting:", id);
    try {
      await fetch("/api/subscriptions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) { console.error("[subscriptions] Delete error:", err); }
  };

  const togglePaid = async (subId: number, currentPaid: boolean) => {
    try {
      await fetch("/api/subscriptions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: subId, mark_paid: !currentPaid }),
      });
      loadSubscriptions();
    } catch (err) { console.error("[subscriptions] Toggle paid error:", err); }
  };

  const togglePriority = async (subId: number, currentPriority: number) => {
    try {
      await fetch("/api/subscriptions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: subId, is_priority: currentPriority ? 0 : 1 }),
      });
      loadSubscriptions();
    } catch (err) { console.error("[subscriptions] Toggle priority error:", err); }
  };

  const addPattern = async (subId: number) => {
    if (!newPattern.trim()) return;
    try {
      await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: "subscription", source_id: subId, payee_pattern: newPattern.trim() }),
      });
      setNewPattern("");
      loadSubscriptions();
    } catch (err) { console.error("[subscriptions] Add pattern error:", err); }
  };

  const deletePattern = async (patternId: number) => {
    try {
      await fetch("/api/matches", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: patternId }),
      });
      loadSubscriptions();
    } catch (err) { console.error("[subscriptions] Delete pattern error:", err); }
  };

  const active = subscriptions.filter((s) => s.is_active);
  const monthlyTotal = active.reduce((s, sub) => s + sub.amount, 0);
  const yearlyTotal = monthlyTotal * 12;

  if (loading) {
    return <div className="page-loading"><Loader2 className="page-loading-spinner animate-spin" /></div>;
  }

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <div>
          <h1 className="page-heading">{locale === "fi" ? "Kausitilaukset" : "Subscriptions"}</h1>
          <p className="page-subtitle">{locale === "fi" ? "Toistuvat tilaus- ja jäsenmaksut" : "Recurring subscription and membership fees"}</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="icon-sm" />
            {locale === "fi" ? "Lisää tilaus" : "Add subscription"}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{locale === "fi" ? "Lisää kausitilaus" : "Add subscription"}</DialogTitle></DialogHeader>
            <form ref={addFormRef} onSubmit={handleAdd} className="form-stack">
              <div className="form-field">
                <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
                <Input name="name" placeholder={locale === "fi" ? "esim. Netflix" : "e.g. Netflix"} required autoComplete="off" />
              </div>
              <div className="form-grid-2">
                <div className="form-field">
                  <Label>{locale === "fi" ? "Summa (€)" : "Amount (€)"}</Label>
                  <Input name="amount" type="text" inputMode="decimal" placeholder="0.00" required autoComplete="off" />
                </div>
                <div className="form-field">
                  <Label>{locale === "fi" ? "Veloituspäivä" : "Billing day"}</Label>
                  <Input name="due_day" type="number" min="1" max="31" placeholder="1" required autoComplete="off" />
                </div>
              </div>
              <Button type="submit">{locale === "fi" ? "Lisää tilaus" : "Add subscription"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="page-grid-2-sm">
        <Card className="metric-card">
          <p className="metric-card-label">{locale === "fi" ? "Kuukaudessa" : "Monthly"}</p>
          <p className="metric-card-value-3xl text-negative"><F v={monthlyTotal} /></p>
          <p className="metric-card-note metric-card-note-mt">{active.length} {locale === "fi" ? "tilausta" : "subscriptions"}</p>
        </Card>
        <Card className="metric-card">
          <p className="metric-card-label">{locale === "fi" ? "Vuodessa" : "Yearly"}</p>
          <p className="metric-card-value-3xl text-negative"><F v={yearlyTotal} /></p>
        </Card>
      </div>

      {subscriptions.length > 0 && (
        <div className="subscription-grid">
          {[...subscriptions].sort((a, b) => a.due_day - b.due_day).map((sub) => (
            <div
              key={sub.id}
              className={`subscription-card ${!sub.is_active ? "is-inactive" : ""}`}
              style={{ backgroundColor: sub.brand_color + "1a", borderColor: sub.brand_color + "33" }}
              onClick={() => { setEditTarget(sub); setEditOpen(true); }}
            >
              <div className="subscription-card-header">
                <div className="subscription-brand-icon" style={{ backgroundColor: sub.brand_color }}>
                  <BrandIcon svg={getBrandConfig(sub.name).svg} logo={sub.brand_logo || sub.name.charAt(0)} />
                </div>
                <div className="subscription-card-info">
                  <div className="list-item-name-row">
                    <p className={`subscription-card-name ${!sub.is_active ? "is-inactive" : ""}`}>{sub.name}</p>
                    {!!sub.is_paid && <Badge className="badge-matched"><Check className="icon-xs" />{locale === "fi" ? "Maksettu" : "Paid"}</Badge>}
                    {!!sub.is_overdue && <Badge variant="destructive">{locale === "fi" ? "Myöhässä" : "Overdue"}</Badge>}
                    <button type="button" className={`priority-toggle ${sub.is_priority ? "is-priority" : ""}`} onClick={(e) => { e.stopPropagation(); togglePriority(sub.id, sub.is_priority); }} title={locale === "fi" ? (sub.is_priority ? "Pakollinen" : "Merkitse pakolliseksi") : (sub.is_priority ? "Must-pay" : "Mark as must-pay")}>
                      <AlertCircle />
                    </button>
                  </div>
                  <p className="subscription-card-meta">
                    {locale === "fi" ? "Veloitus" : "Billing"} {resolveDayThisMonth(sub.due_day)}. {locale === "fi" ? "päivä" : ""}
                    {sub.patterns.length > 0 && <span className="list-item-patterns"> – {sub.patterns.map((p) => p.pattern).join(", ")}</span>}
                  </p>
                </div>
                <div className="subscription-card-right">
                  <p className="subscription-card-amount"><F v={sub.amount} /></p>
                </div>
              </div>
              <span className="subscription-toggle" onClick={(e) => e.stopPropagation()}>
                <Switch checked={!!sub.is_active} onCheckedChange={() => toggleSub(sub.id, sub.is_active)} />
              </span>
            </div>
          ))}
        </div>
      )}

      {subscriptions.length === 0 && (
        <p className="page-subtitle">{locale === "fi" ? "Ei vielä tilauksia. Lisää ensimmäinen!" : "No subscriptions yet. Add your first one!"}</p>
      )}

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "fi" ? "Muokkaa tilausta" : "Edit subscription"}</DialogTitle></DialogHeader>
          {editTarget && (
            <form ref={editFormRef} onSubmit={handleEdit} className="form-stack">
              <div className="form-field">
                <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
                <Input name="name" defaultValue={editTarget.name} required autoComplete="off" />
              </div>
              <div className="form-grid-2">
                <div className="form-field">
                  <Label>{locale === "fi" ? "Summa (€)" : "Amount (€)"}</Label>
                  <Input name="amount" type="text" inputMode="decimal" defaultValue={editTarget.amount} required autoComplete="off" />
                </div>
                <div className="form-field">
                  <Label>{locale === "fi" ? "Veloituspäivä" : "Billing day"}</Label>
                  <Input name="due_day" type="number" min="1" max="31" defaultValue={editTarget.due_day} required autoComplete="off" />
                </div>
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Yhdistä maksajaan" : "Match payee"}</Label>
                <div className="match-pattern-row">
                  <Input
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                    placeholder={locale === "fi" ? "esim. *Netflix*" : "e.g. *Netflix*"}
                    className="match-pattern-input"
                    autoComplete="off"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => addPattern(editTarget.id)}>{locale === "fi" ? "Lisää" : "Add"}</Button>
                </div>
                {editTarget.patterns.length > 0 && (
                  <div className="match-pattern-list">
                    {editTarget.patterns.map((p) => (
                      <div key={p.id} className="match-pattern-item">
                        <span className="match-pattern-tag">{p.pattern}</span>
                        <button type="button" className="batch-remove-btn" onClick={() => deletePattern(p.id)}>
                          <X />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant={editTarget.is_paid ? "outline" : "secondary"}
                size="sm"
                onClick={() => { togglePaid(editTarget.id, editTarget.is_paid); setEditOpen(false); }}
              >
                {editTarget.is_paid
                  ? (locale === "fi" ? "Merkitse maksamattomaksi" : "Mark unpaid")
                  : (locale === "fi" ? "Merkitse maksetuksi" : "Mark paid")}
              </Button>
              <Button
                type="button"
                variant={editTarget.is_priority ? "destructive" : "outline"}
                size="sm"
                onClick={() => { togglePriority(editTarget.id, editTarget.is_priority); setEditTarget({ ...editTarget, is_priority: editTarget.is_priority ? 0 : 1 }); }}
              >
                {editTarget.is_priority
                  ? (locale === "fi" ? "Pakollinen tilaus" : "Must-pay subscription")
                  : (locale === "fi" ? "Merkitse pakolliseksi" : "Mark as must-pay")}
              </Button>
              <div className="form-grid-2">
                <Button type="button" variant="destructive" onClick={() => { deleteSub(editTarget.id); setEditOpen(false); }}>
                  {locale === "fi" ? "Poista" : "Delete"}
                </Button>
                <Button type="submit">{locale === "fi" ? "Tallenna" : "Save"}</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
