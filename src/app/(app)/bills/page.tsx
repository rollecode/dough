"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import { Plus, AlertCircle, Loader2, Check, X } from "lucide-react";
import { F } from "@/components/ui/f";

interface Bill {
  id: number;
  name: string;
  amount: number;
  due_day: number;
  category: string;
  is_active: number;
  is_paid: boolean;
  is_manual_paid: boolean;
  paid_amount: number | null;
  amount_diff: number | null;
  is_overdue: boolean;
  is_due_soon: boolean;
  is_priority: number;
  patterns: { id: number; payee_pattern: string; min_amount: number; max_amount: number }[];
  average_amount: number | null;
  history_count: number;
}

export default function BillsPage() {
  const { t, locale } = useLocale();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Bill | null>(null);
  const [patternOpen, setPatternOpen] = useState<number | null>(null);
  const [newPattern, setNewPattern] = useState("");
  const [patternMinAmount, setPatternMinAmount] = useState("");
  const [patternMaxAmount, setPatternMaxAmount] = useState("");
  const addFormRef = useRef<HTMLFormElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);

  const loadBills = useCallback(() => {
    console.debug("[bills] Loading bills");
    fetch("/api/bills")
      .then((r) => r.json())
      .then((data) => {
        if (data.bills) {
          console.info("[bills] Loaded", data.bills.length, "bills");
          setBills(data.bills);
        }
      })
      .catch((err) => console.error("[bills] Load error:", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadBills(); }, [loadBills]);

  // SSE: reload when data changes
  useEvent("data:updated", useCallback(() => { loadBills(); }, [loadBills]));
  useEvent("sync:complete", useCallback(() => { loadBills(); }, [loadBills]));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = addFormRef.current;
    if (!form) return;
    const fd = new FormData(form);
    try {
      await fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          amount: (fd.get("amount") as string).replace(",", "."),
          due_day: parseInt(fd.get("due_day") as string, 10),
          category: fd.get("category"),
        }),
      });
      setAddOpen(false);
      form.reset();
      loadBills();
    } catch (err) { console.error("[bills] Add error:", err); }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editFormRef.current) return;
    const fd = new FormData(editFormRef.current);
    try {
      await fetch("/api/bills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editTarget.id,
          name: fd.get("name"),
          amount: (fd.get("amount") as string).replace(",", "."),
          due_day: parseInt(fd.get("due_day") as string, 10),
          category: fd.get("category"),
        }),
      });
      setEditOpen(false);
      setEditTarget(null);
      loadBills();
    } catch (err) { console.error("[bills] Edit error:", err); }
  };

  const toggleBill = async (id: number, currentActive: number) => {
    setBills((prev) => prev.map((b) => b.id === id ? { ...b, is_active: currentActive ? 0 : 1 } : b));
    try {
      await fetch("/api/bills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_active: currentActive ? 0 : 1 }),
      });
    } catch (err) { console.error("[bills] Toggle error:", err); }
  };

  const deleteBill = async (id: number) => {
    try {
      await fetch("/api/bills", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setBills((prev) => prev.filter((b) => b.id !== id));
    } catch (err) { console.error("[bills] Delete error:", err); }
  };

  const togglePaid = async (billId: number, currentPaid: boolean) => {
    try {
      await fetch("/api/bills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: billId, mark_paid: !currentPaid }),
      });
      loadBills();
    } catch (err) { console.error("[bills] Toggle paid error:", err); }
  };

  const togglePriority = async (billId: number, currentPriority: number) => {
    try {
      await fetch("/api/bills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: billId, is_priority: currentPriority ? 0 : 1 }),
      });
      loadBills();
    } catch (err) { console.error("[bills] Toggle priority error:", err); }
  };

  const addPattern = async (billId: number) => {
    if (!newPattern.trim()) return;
    try {
      await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: "bill",
          source_id: billId,
          payee_pattern: newPattern.trim(),
          min_amount: parseFloat(patternMinAmount) || 0,
          max_amount: parseFloat(patternMaxAmount) || 0,
        }),
      });
      setNewPattern("");
      setPatternMinAmount("");
      setPatternMaxAmount("");
      setPatternOpen(null);
      loadBills();
    } catch (err) { console.error("[bills] Add pattern error:", err); }
  };

  const deletePattern = async (patternId: number) => {
    console.info("[bills] Deleting pattern:", patternId);
    try {
      await fetch("/api/matches", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: patternId }),
      });
      loadBills();
    } catch (err) { console.error("[bills] Delete pattern error:", err); }
  };

  const updatePattern = async (patternId: number, min: number, max: number) => {
    console.info("[bills] Updating pattern:", patternId, "min:", min, "max:", max);
    try {
      await fetch("/api/matches", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: patternId, min_amount: min, max_amount: max }),
      });
      loadBills();
    } catch (err) { console.error("[bills] Update pattern error:", err); }
  };

  const active = bills.filter((b) => b.is_active);
  const monthlyTotal = active.reduce((s, b) => s + b.amount, 0);
  const remainingUnpaid = active.filter((b) => !b.is_paid).reduce((s, b) => s + b.amount, 0);
  const overdueCount = active.filter((b) => b.is_overdue).length;
  const paidCount = active.filter((b) => b.is_paid).length;

  if (loading) {
    return <div className="page-loading"><Loader2 className="page-loading-spinner animate-spin" /></div>;
  }

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <div>
          <h1 className="page-heading">{t.bills.title}</h1>
          <p className="page-subtitle">{t.bills.subtitle}</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="icon-sm" />
            {t.bills.addBill}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t.bills.addRecurringBill}</DialogTitle></DialogHeader>
            <form ref={addFormRef} onSubmit={handleAdd} className="form-stack">
              <div className="form-field">
                <Label>{t.bills.name}</Label>
                <Input name="name" placeholder={t.bills.namePlaceholder} required />
              </div>
              <div className="form-grid-2">
                <div className="form-field">
                  <Label>{t.bills.amountEur}</Label>
                  <Input name="amount" type="text" inputMode="decimal" placeholder="0.00" required />
                </div>
                <div className="form-field">
                  <Label>{t.bills.dueDay}</Label>
                  <Input name="due_day" type="number" min="1" max="31" placeholder="1" required />
                </div>
              </div>
              <div className="form-field">
                <Label>{t.bills.category}</Label>
                <Input name="category" placeholder={t.bills.categoryPlaceholder} />
              </div>
              <Button type="submit">{t.bills.addBill}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="page-grid-2-sm">
        <Card className="metric-card">
          <p className="metric-card-label">{t.bills.monthlyTotal}</p>
          <p className="metric-card-value-3xl"><F v={monthlyTotal} /></p>
          <p className="metric-card-note metric-card-note-mt">
            {paidCount}/{active.length} {locale === "fi" ? "maksettu" : "paid"}
          </p>
        </Card>
        <Card className="metric-card">
          <div className="page-header-row">
            <div>
              <p className="metric-card-label">{locale === "fi" ? "Maksamatta" : "Unpaid"}</p>
              <p className="metric-card-value-3xl text-negative"><F v={remainingUnpaid} /></p>
              <p className="metric-card-note metric-card-note-mt">
                {overdueCount > 0
                  ? `${overdueCount} ${locale === "fi" ? "myöhässä" : "overdue"}`
                  : t.bills.stillDueBeforeMonthEnd}
              </p>
            </div>
            {overdueCount > 0 && <AlertCircle className="metric-card-icon-standalone text-negative" />}
          </div>
        </Card>
      </div>

      {bills.length > 0 && (
        <Card className="list-card list-card-divider">
          {[...bills].sort((a, b) => a.due_day - b.due_day).map((bill) => (
            <div key={bill.id} className="list-item list-item-col">
              <div
                className="list-item-main"
                onClick={() => { setEditTarget(bill); setEditOpen(true); }}
              >
                <div className="list-item-body">
                  <div className="list-item-name-row">
                    <p className={`list-item-name ${!bill.is_active ? "is-inactive" : ""}`}>{bill.name}</p>
                    {bill.is_paid && <Badge className="badge-matched"><Check className="icon-xs" />{locale === "fi" ? "Maksettu" : "Paid"}</Badge>}
                    {bill.is_overdue && <Badge variant="destructive">{locale === "fi" ? "Myöhässä" : "Overdue"}</Badge>}
                    {bill.is_due_soon && !bill.is_paid && <Badge variant="secondary">{t.bills.dueSoon}</Badge>}
                    <button type="button" className={`priority-toggle ${bill.is_priority ? "is-priority" : ""}`} onClick={(e) => { e.stopPropagation(); togglePriority(bill.id, bill.is_priority); }} title={locale === "fi" ? (bill.is_priority ? "Pakollinen lasku" : "Merkitse pakolliseksi") : (bill.is_priority ? "Must-pay" : "Mark as must-pay")}>
                      <AlertCircle />
                    </button>
                  </div>
                  <p className="list-item-meta">
                    {bill.category ? `${bill.category} · ` : ""}{locale === "fi" ? "Erääntyy" : t.bills.dueOn} {bill.due_day}. {t.bills.dayOfMonth}
                    {bill.patterns.length > 0 && (
                      <span className="list-item-patterns"> – {bill.patterns.map((p) => p.payee_pattern).join(", ")}</span>
                    )}
                  </p>
                </div>
                <div className="list-item-end">
                  <p className="list-item-amount-value">
                    <F v={bill.is_paid && bill.paid_amount ? bill.paid_amount : bill.amount} />
                  </p>
                  {bill.amount_diff && (
                    <p className={`list-item-meta ${bill.amount_diff > 0 ? "text-negative" : "text-positive"}`}>
                      {bill.amount_diff > 0 ? <>+<F v={bill.amount_diff} /></> : <F v={bill.amount_diff} />} {locale === "fi" ? "vs odotettu" : "vs expected"}
                    </p>
                  )}
                  {bill.average_amount && bill.history_count >= 2 && !bill.amount_diff && (
                    <p className="list-item-meta">{locale === "fi" ? "ka" : "avg"} <F v={bill.average_amount} /></p>
                  )}
                  <span onClick={(e) => e.stopPropagation()}>
                    <Switch checked={!!bill.is_active} onCheckedChange={() => toggleBill(bill.id, bill.is_active)} />
                  </span>
                </div>
              </div>
              {patternOpen === bill.id && (
                <div className="match-pattern-row">
                  <Input
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                    placeholder={locale === "fi" ? "esim. *Elisa* tai Helen Oy" : "e.g. *Netflix* or Company Name"}
                    className="match-pattern-input"
                  />
                  <Button type="button" size="sm" onClick={() => addPattern(bill.id)}>{locale === "fi" ? "Lisää" : "Add"}</Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "fi" ? "Muokkaa laskua" : "Edit bill"}</DialogTitle></DialogHeader>
          {editTarget && (
            <form ref={editFormRef} onSubmit={handleEdit} className="form-stack">
              <div className="form-field">
                <Label>{t.bills.name}</Label>
                <Input name="name" defaultValue={editTarget.name} required />
              </div>
              <div className="form-grid-2">
                <div className="form-field">
                  <Label>{t.bills.amountEur}</Label>
                  <Input name="amount" type="text" inputMode="decimal" defaultValue={editTarget.amount} required />
                </div>
                <div className="form-field">
                  <Label>{t.bills.dueDay}</Label>
                  <Input name="due_day" type="number" min="1" max="31" defaultValue={editTarget.due_day} required />
                </div>
              </div>
              <div className="form-field">
                <Label>{t.bills.category}</Label>
                <Input name="category" defaultValue={editTarget.category} placeholder={t.bills.categoryPlaceholder} />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Yhdistä maksajaan" : "Match payee"}</Label>
                <div className="match-pattern-row">
                  <Input
                    value={newPattern}
                    onChange={(e) => setNewPattern(e.target.value)}
                    placeholder={locale === "fi" ? "esim. *Elisa*" : "e.g. *Netflix*"}
                    className="match-pattern-input"
                    autoComplete="off"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => { addPattern(editTarget.id); }}>{locale === "fi" ? "Lisää" : "Add"}</Button>
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
                {editTarget.patterns.length > 0 && (
                  <div className="match-pattern-list">
                    {editTarget.patterns.map((p) => (
                      <div key={p.id} className="match-pattern-item">
                        <span className="match-pattern-tag">{p.payee_pattern}</span>
                        <Input
                          defaultValue={p.min_amount || ""}
                          placeholder="Min €"
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          className="match-pattern-input-sm"
                          onBlur={(e) => updatePattern(p.id, parseFloat(e.target.value) || 0, p.max_amount)}
                        />
                        <Input
                          defaultValue={p.max_amount || ""}
                          placeholder="Max €"
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          className="match-pattern-input-sm"
                          onBlur={(e) => updatePattern(p.id, p.min_amount, parseFloat(e.target.value) || 0)}
                        />
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
                  ? (locale === "fi" ? "Pakollinen lasku" : "Must-pay bill")
                  : (locale === "fi" ? "Merkitse pakolliseksi" : "Mark as must-pay")}
              </Button>
              <div className="form-grid-2">
                <Button type="button" variant="destructive" onClick={() => { deleteBill(editTarget.id); setEditOpen(false); }}>
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
