"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Loader2, GripVertical, Trash2, Sparkles, ArrowRight, ChevronDown } from "lucide-react";
import { F } from "@/components/ui/f";
import { accountSlug } from "@/app/(app)/transactions/page";
import { SwipeRow } from "@/components/accounts/swipe-row";

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  on_budget: number;
  closed: number;
  source: string;
  synci_account_id: string;
}

// Spending accounts shown on /accounts; debts live in /debts, investments in /investments
const SPENDING_TYPES = ["checking", "savings", "cash"];
const isSpending = (type: string) => SPENDING_TYPES.includes(type);

function typeLabel(type: string, locale: string): string {
  const fi: Record<string, string> = { checking: "Käyttötili", savings: "Säästötili", cash: "Käteinen", otherAsset: "Sijoitus", otherDebt: "Velka" };
  const en: Record<string, string> = { checking: "Checking", savings: "Savings", cash: "Cash", otherAsset: "Asset", otherDebt: "Debt" };
  return (locale === "fi" ? fi : en)[type] || type;
}

export default function AccountsPage() {
  const { locale, fmt, fmtDate } = useLocale();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [editNote, setEditNote] = useState("");
  const [trueBalance, setTrueBalance] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcile, setReconcile] = useState<{ diff: number; explanation: string; suspects: { id: string; date: string; payee: string; amount: number }[] } | null>(null);
  const addFormRef = useRef<HTMLFormElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);
  const [orderedOpen, setOrderedOpen] = useState<Account[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/accounts").then((r) => r.json()),
      fetch("/api/profile").then((r) => r.json()),
      fetch("/api/household").then((r) => r.json()),
      fetch("/api/account-notes").then((r) => r.json()),
    ]).then(([acctData, profileData, householdData, notesData]) => {
      if (acctData.accounts) setAccounts(acctData.accounts);
      if (profileData.linkedAccountIds) setLinkedIds(profileData.linkedAccountIds);
      if (householdData.settings?.budget_excluded_accounts) {
        try { setExcludedIds(JSON.parse(householdData.settings.budget_excluded_accounts)); } catch {}
      }
      if (notesData.notes) setNotes(notesData.notes);
    }).catch((err) => console.error("[accounts] Load error:", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Open spending accounts, in their saved order, drag-reorderable
  useEffect(() => {
    setOrderedOpen(accounts.filter((a) => !a.closed && isSpending(a.type)));
  }, [accounts]);

  const handleAcctDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setOrderedOpen((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(idx);
  };

  const handleAcctDragEnd = () => {
    setDragIdx(null);
    Promise.all(
      orderedOpen.map((a, i) =>
        fetch("/api/accounts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id, sort_order: i }) })
      )
    ).then(() => load()).catch(() => {});
    console.info("[accounts] Saved account order");
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = addFormRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const body = {
      name: fd.get("name") as string,
      type: fd.get("type") as string,
      balance: parseFloat(((fd.get("balance") as string) || "0").replace(",", ".")) || 0,
    };
    try {
      const res = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) { setAddOpen(false); form.reset(); load(); }
      else { const j = await res.json(); alert(j.error || "Failed"); }
    } catch (err) { console.error("[accounts] Add error:", err); }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editFormRef.current) return;
    const fd = new FormData(editFormRef.current);
    const body = {
      id: editTarget.id,
      name: fd.get("name") as string,
      type: fd.get("type") as string,
      balance: parseFloat(((fd.get("balance") as string) || "0").replace(",", ".")) || 0,
    };
    try {
      await fetch("/api/accounts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await fetch("/api/account-notes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ynab_account_id: editTarget.id, note: editNote }) });
      setEditTarget(null);
      load();
    } catch (err) { console.error("[accounts] Edit error:", err); }
  };

  const runReconcile = async () => {
    if (!editTarget || !trueBalance.trim()) return;
    setReconciling(true);
    setReconcile(null);
    try {
      const res = await fetch("/api/accounts/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: editTarget.id, true_balance: trueBalance, locale }),
      });
      const d = await res.json();
      if (!d.error) setReconcile({ diff: d.diff, explanation: d.explanation || "", suspects: d.suspects || [] });
    } catch (err) {
      console.error("[accounts] Reconcile error:", err);
    } finally {
      setReconciling(false);
    }
  };

  // Delete a suspect transaction straight from the reconcile panel; the delete endpoint reverses
  // the account balance, so we adjust the shown difference by the removed amount too.
  const deleteSuspect = async (txId: string, amount: number) => {
    try {
      const res = await fetch("/api/ynab/transaction", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: txId }),
      });
      if (!res.ok) { console.error("[accounts] Delete suspect failed:", res.status); return; }
      setReconcile((prev) => prev ? {
        ...prev,
        diff: Math.round((prev.diff + amount) * 100) / 100,
        suspects: prev.suspects.filter((s) => s.id !== txId),
      } : prev);
      load();
    } catch (err) {
      console.error("[accounts] Delete suspect error:", err);
    }
  };

  // Apply the typed bank balance directly: sets the account balance and records a reconciliation
  // adjustment so history matches. This is the fix when the difference is a balance drift rather
  // than a duplicate transaction to delete (deleting suspects can't close a drift).
  const applyTrueBalance = async () => {
    if (!editTarget) return;
    const bal = parseFloat(trueBalance.replace(",", "."));
    if (!isFinite(bal)) return;
    try {
      const res = await fetch("/api/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editTarget.id, balance: bal }),
      });
      if (!res.ok) { console.error("[accounts] Apply balance failed:", res.status); return; }
      setReconcile(null);
      setTrueBalance("");
      setEditTarget(null);
      load();
    } catch (err) {
      console.error("[accounts] Apply balance error:", err);
    }
  };

  const toggleLinked = async (id: string) => {
    const next = linkedIds.includes(id) ? linkedIds.filter((x) => x !== id) : [...linkedIds, id];
    setLinkedIds(next);
    await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linked_account_ids: next }) }).catch(() => {});
  };

  const toggleExcluded = async (id: string) => {
    const next = excludedIds.includes(id) ? excludedIds.filter((x) => x !== id) : [...excludedIds, id];
    setExcludedIds(next);
    await fetch("/api/household", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ budget_excluded_accounts: JSON.stringify(next) }) }).catch(() => {});
  };

  const closeOrDelete = async (acct: Account) => {
    try {
      await fetch("/api/accounts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: acct.id }) });
      setEditTarget(null);
      load();
    } catch (err) { console.error("[accounts] Delete error:", err); }
  };

  if (loading) {
    return <div className="page-loading"><Loader2 className="page-loading-spinner animate-spin" /></div>;
  }

  const closed = accounts.filter((a) => a.closed && isSpending(a.type));
  const total = orderedOpen.reduce((s, a) => s + a.balance, 0);

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <div>
          <h1 className="page-heading">{locale === "fi" ? "Tilit" : "Accounts"}</h1>
          <p className="page-subtitle">{locale === "fi" ? "Hallinnoi tilejä, saldoja ja asetuksia" : "Manage accounts, balances and settings"}</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="icon-sm" />
            {locale === "fi" ? "Lisää tili" : "Add account"}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{locale === "fi" ? "Uusi tili" : "New account"}</DialogTitle></DialogHeader>
            <form ref={addFormRef} onSubmit={handleAdd} className="form-stack">
              <div className="form-field">
                <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
                <Input name="name" required autoComplete="off" />
              </div>
              <div className="form-grid-2">
                <div className="form-field">
                  <Label>{locale === "fi" ? "Tyyppi" : "Type"}</Label>
                  <select name="type" className="input" defaultValue="checking">
                    {SPENDING_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t, locale)}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <Label>{locale === "fi" ? "Saldo (€)" : "Balance (€)"}</Label>
                  <Input name="balance" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" />
                </div>
              </div>
              <Button type="submit">{locale === "fi" ? "Lisää" : "Add"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="metric-card">
        <p className="metric-card-label">{locale === "fi" ? "Yhteensä avoimilla tileillä" : "Total across open accounts"}</p>
        <p className={`metric-card-value-3xl ${total < -0.005 ? "is-negative" : total > 0.005 ? "is-positive" : ""}`}><F v={total} s=" €" /></p>
        <p className="metric-card-note metric-card-note-mt">{orderedOpen.length} {locale === "fi" ? "tiliä" : "accounts"}</p>
      </Card>

      {orderedOpen.length > 0 && (
        <Card className="list-card list-card-divider">
          {orderedOpen.map((a, idx) => (
            <SwipeRow
              key={a.id}
              href={`/transactions/${accountSlug(a.name)}`}
              onEdit={() => { setEditTarget(a); setEditNote(notes[a.id] || ""); setReconcile(null); setTrueBalance(""); }}
              onDragOver={(e) => handleAcctDragOver(e, idx)}
              rowClassName={`list-item acct-row ${dragIdx === idx ? "is-dragging" : ""}`}
              editLabel={locale === "fi" ? "Muokkaa" : "Edit"}
            >
              <button
                type="button"
                className="acct-grip"
                draggable
                onClick={(e) => e.stopPropagation()}
                onDragStart={() => setDragIdx(idx)}
                onDragEnd={handleAcctDragEnd}
                aria-label={locale === "fi" ? "Järjestä" : "Reorder"}
              >
                <GripVertical />
              </button>
              <div className="list-item-body">
                <div className="list-item-name-row">
                  <p className="list-item-name">{a.name}</p>
                  {linkedIds.includes(a.id) && <span className="account-badge">{locale === "fi" ? "Oma" : "Mine"}</span>}
                  {excludedIds.includes(a.id) && <span className="account-badge is-muted">{locale === "fi" ? "Ei budjetissa" : "Off-budget"}</span>}
                </div>
                <p className="list-item-meta">{typeLabel(a.type, locale)}{a.source === "manual" ? ` · ${locale === "fi" ? "käsin" : "manual"}` : a.synci_account_id ? " · Synci" : ""}</p>
              </div>
              <div className="list-item-end">
                <p className={`list-item-amount-value ${a.balance < -0.005 ? "is-negative" : a.balance > 0.005 ? "is-positive" : ""}`}><F v={a.balance} s=" €" /></p>
              </div>
            </SwipeRow>
          ))}
        </Card>
      )}

      {closed.length > 0 && (
        <Card className="list-card list-card-divider">
          <button type="button" className="budget-hidden-toggle" onClick={() => setShowClosed((s) => !s)}>
            <ChevronDown className={`budget-hidden-chevron ${showClosed ? "is-open" : ""}`} />
            <span>{locale === "fi" ? "Suljetut tilit" : "Closed accounts"}</span>
            <span className="budget-hidden-count">{closed.length}</span>
          </button>
          {showClosed && closed.map((a) => (
            <SwipeRow
              key={a.id}
              href={`/transactions/${accountSlug(a.name)}`}
              onEdit={() => { setEditTarget(a); setEditNote(notes[a.id] || ""); setReconcile(null); setTrueBalance(""); }}
              rowClassName="list-item"
              editLabel={locale === "fi" ? "Muokkaa" : "Edit"}
            >
              <div className="list-item-body">
                <p className="list-item-name is-inactive">{a.name}</p>
                <p className="list-item-meta">{typeLabel(a.type, locale)}</p>
              </div>
              <div className="list-item-end">
                <p className={`list-item-amount-value ${a.balance < -0.005 ? "is-negative" : a.balance > 0.005 ? "is-positive" : ""}`}><F v={a.balance} s=" €" /></p>
              </div>
            </SwipeRow>
          ))}
        </Card>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) { setEditTarget(null); setReconcile(null); setTrueBalance(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "fi" ? "Muokkaa tiliä" : "Edit account"}</DialogTitle></DialogHeader>
          {editTarget && (
            <form ref={editFormRef} onSubmit={handleEdit} className="form-stack">
              <div className="form-field">
                <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
                <Input name="name" defaultValue={editTarget.name} required autoComplete="off" />
              </div>
              <div className="form-grid-2">
                <div className="form-field">
                  <Label>{locale === "fi" ? "Tyyppi" : "Type"}</Label>
                  <select name="type" className="input" defaultValue={editTarget.type}>
                    {SPENDING_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t, locale)}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <Label>{locale === "fi" ? "Saldo (€)" : "Balance (€)"}</Label>
                  <Input name="balance" type="text" inputMode="decimal" defaultValue={editTarget.balance} autoComplete="off" />
                </div>
              </div>
              <div className="account-toggle-row">
                <div>
                  <p className="account-toggle-label">{locale === "fi" ? "Oma käyttötili" : "My spending account"}</p>
                  <p className="settings-help">{locale === "fi" ? "Tili jolta maksat ostoksia" : "The account you pay from"}</p>
                </div>
                <Switch checked={linkedIds.includes(editTarget.id)} onCheckedChange={() => toggleLinked(editTarget.id)} />
              </div>
              <div className="account-toggle-row">
                <div>
                  <p className="account-toggle-label">{locale === "fi" ? "Pois päiväbudjetista" : "Exclude from daily budget"}</p>
                  <p className="settings-help">{locale === "fi" ? "Ei lasketa käytettävissä olevaan saldoon, mutta mukana varallisuudessa" : "Not counted in available balance, but included in net worth"}</p>
                </div>
                <Switch checked={excludedIds.includes(editTarget.id)} onCheckedChange={() => toggleExcluded(editTarget.id)} />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Muistiinpano AI:lle" : "Note for AI"}</Label>
                <Input value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder={locale === "fi" ? "esim. Puskuritili" : "e.g. Buffer account"} autoComplete="off" />
              </div>

              <a href={`/transactions/${accountSlug(editTarget.name)}`} className="account-tx-link">
                {locale === "fi" ? "Näytä tapahtumat" : "View transactions"}
                <ArrowRight />
              </a>

              <div className="form-field reconcile-field">
                <Label>{locale === "fi" ? "Tarkista pankin saldoa vasten" : "Check against the bank balance"}</Label>
                <p className="settings-help">{locale === "fi" ? "Syötä pankin todellinen saldo, niin AI etsii erot ja duplikaatit viime päiviltä." : "Enter the real bank balance and the AI finds the differences and duplicates from the last few days."}</p>
                <div className="reconcile-row">
                  <Input value={trueBalance} onChange={(e) => setTrueBalance(e.target.value)} type="text" inputMode="decimal" placeholder={locale === "fi" ? "Pankin saldo €" : "Bank balance €"} autoComplete="off" />
                  <Button type="button" variant="outline" onClick={runReconcile} disabled={reconciling || !trueBalance.trim()}>
                    {reconciling ? <Loader2 className="icon-sm animate-spin" /> : <><Sparkles className="icon-sm" />{locale === "fi" ? "Tarkista" : "Check"}</>}
                  </Button>
                </div>
                {reconcile && (
                  <div className="reconcile-result">
                    {reconcile.diff === 0 ? (
                      <p className="reconcile-diff is-ok">{locale === "fi" ? "Saldo täsmää." : "The balance matches."}</p>
                    ) : (
                      <p className="reconcile-diff" data-negative={reconcile.diff < 0 || undefined}>
                        {reconcile.diff > 0
                          ? (locale === "fi" ? `Saldo on ${fmt(Math.abs(reconcile.diff))} € liian pieni` : `Balance is ${fmt(Math.abs(reconcile.diff))} € too low`)
                          : (locale === "fi" ? `Saldo on ${fmt(Math.abs(reconcile.diff))} € liian suuri` : `Balance is ${fmt(Math.abs(reconcile.diff))} € too high`)}
                      </p>
                    )}
                    {reconcile.explanation && <p className="reconcile-explanation">{reconcile.explanation}</p>}
                    {reconcile.suspects.map((s) => (
                      <div key={s.id} className="reconcile-suspect">
                        <div className="reconcile-suspect-body">
                          <span className="reconcile-suspect-payee">{s.payee}</span>
                          <span className="reconcile-suspect-meta">{fmtDate(s.date)}</span>
                        </div>
                        <span className="reconcile-suspect-amt" data-negative={s.amount < 0 || undefined}>{s.amount < 0 ? "-" : "+"}<F v={Math.abs(s.amount)} s=" €" /></span>
                        <button type="button" className="reconcile-suspect-del" onClick={() => deleteSuspect(s.id, s.amount)} aria-label={locale === "fi" ? "Poista" : "Delete"}>
                          <Trash2 />
                        </button>
                      </div>
                    ))}
                    {reconcile.diff !== 0 && (
                      <Button type="button" variant="outline" size="sm" className="reconcile-apply" onClick={applyTrueBalance}>
                        {locale === "fi" ? "Aseta saldoksi pankin saldo" : "Set balance to the bank balance"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="form-grid-2">
                <Button type="button" variant="destructive" onClick={() => closeOrDelete(editTarget)}>
                  {editTarget.source === "manual" ? (locale === "fi" ? "Poista" : "Delete") : (locale === "fi" ? "Sulje tili" : "Close account")}
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
