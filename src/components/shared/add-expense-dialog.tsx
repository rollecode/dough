"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Paperclip, X } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { useYnab } from "@/lib/ynab-context";
import { titleCasePayee } from "@/lib/text-utils";
import { PayeeInput } from "@/components/shared/payee-input";

// Human label for a duplicate candidate's date: today / tomorrow / d.m.yyyy.
function dayLabel(iso: string, locale: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  if (iso === todayIso) return locale === "fi" ? "tänään" : "today";
  if (iso === tomorrowIso) return locale === "fi" ? "huomenna" : "tomorrow";
  const p = iso.split("-");
  return p.length === 3 ? `${Number(p[2])}.${Number(p[1])}.${p[0]}` : iso;
}

interface AddExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddExpenseDialog({ open, onOpenChange }: AddExpenseDialogProps) {
  const { locale } = useLocale();
  const { refresh } = useYnab();
  const [addAmount, setAddAmount] = useState("");
  const [addPayee, setAddPayee] = useState("");
  const [addMemo, setAddMemo] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [linkedAccountId, setLinkedAccountId] = useState("");
  const [linkedAccountName, setLinkedAccountName] = useState("");
  const [receiptParsing, setReceiptParsing] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptType, setReceiptType] = useState("");
  const [batchTransactions, setBatchTransactions] = useState<{ payee: string; amount: string; date: string; account_id: string; account_name: string }[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [allAccounts, setAllAccounts] = useState<{ id: string; name: string }[]>([]);
  const [payees, setPayees] = useState<string[]>([]);
  const [dupCandidates, setDupCandidates] = useState<{ id: string; date: string; payee: string; amount: number; account: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    console.debug("[add-expense] Loading accounts");
    fetch("/api/payees").then((r) => r.json()).then((d) => { if (Array.isArray(d.payees)) setPayees(d.payees); }).catch(() => {});
    Promise.all([
      fetch("/api/profile").then((r) => r.json()),
      fetch("/api/ynab/accounts").then((r) => r.json()).catch(() => ({ accounts: [] })),
    ]).then(([profileData, accountsData]) => {
      if (accountsData.accounts) {
        setAllAccounts(accountsData.accounts.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })));
      }
      const ids = profileData.linkedAccountIds || [];
      if (ids.length > 0 && accountsData.accounts) {
        setLinkedAccountId(ids[0]);
        const account = accountsData.accounts.find((a: { id: string; name: string }) => a.id === ids[0]);
        if (account) setLinkedAccountName(account.name);
      }
    }).catch(() => {});
  }, []);

  const resolveAccountFromMemo = async (memo: string) => {
    if (!memo.trim()) return;
    try {
      const res = await fetch("/api/receipt/resolve-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo }),
      });
      const data = await res.json();
      if (data.account_id && data.account_id !== linkedAccountId) {
        setLinkedAccountId(data.account_id);
        setLinkedAccountName(data.account_name || "");
      }
    } catch { /* ignore */ }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    console.info("[add-expense] Receipt uploaded:", file.name, file.type);
    setReceiptParsing(true);
    setReceiptPreview(URL.createObjectURL(file));
    setReceiptType(file.type);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      try {
        const res = await fetch("/api/receipt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64, media_type: file.type }),
        });
        const data = await res.json();
        if (data.transactions && data.transactions.length > 1) {
          const batch = data.transactions.map((tx: { payee: string; amount: string; date?: string; account?: string }) => {
            const payee = titleCasePayee(tx.payee || "");
            let accId = linkedAccountId;
            let accName = linkedAccountName;
            if (tx.account) {
              const matched = allAccounts.find((a) => a.name === tx.account);
              if (matched) { accId = matched.id; accName = matched.name; }
            }
            return { payee, amount: tx.amount, date: tx.date || new Date().toISOString().slice(0, 10), account_id: accId, account_name: accName };
          });
          setBatchTransactions(batch);
        } else {
          if (data.payee) setAddPayee(titleCasePayee(data.payee));
          if (data.amount) setAddAmount(data.amount);
          if (data.account) {
            const matched = allAccounts.find((a) => a.name === data.account);
            if (matched) { setLinkedAccountId(matched.id); setLinkedAccountName(matched.name); }
          }
        }
      } catch (err) {
        console.error("[add-expense] Receipt parse error:", err);
      } finally {
        setReceiptParsing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddExpense = async (force = false) => {
    if (!linkedAccountId || !addAmount || !addPayee) return;
    // Guard against double-entering something Synci has already synced (or will sync tomorrow):
    // warn if a transaction with the same amount already exists today/tomorrow. Skipped on force.
    if (!force) {
      const amountNum = Math.abs(parseFloat(addAmount.replace(",", ".")));
      if (isFinite(amountNum) && amountNum > 0) {
        try {
          const today = new Date().toISOString().slice(0, 10);
          const res = await fetch(`/api/transactions/check-duplicate?amount=${amountNum}&date=${today}`);
          const d = await res.json();
          if (Array.isArray(d.duplicates) && d.duplicates.length > 0) {
            console.info("[add-expense] Possible duplicate(s):", d.duplicates.length);
            setDupCandidates(d.duplicates);
            return;
          }
        } catch { /* if the check fails, do not block the add */ }
      }
    }
    setAddLoading(true);
    try {
      const res = await fetch("/api/ynab/transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: linkedAccountId,
          amount: addAmount.replace(",", "."),
          payee_name: addPayee,
          memo: addMemo || undefined,
        }),
      });
      if (res.ok) {
        onOpenChange(false);
        setAddAmount(""); setAddPayee(""); setAddMemo("");
        setReceiptPreview(null); setBatchTransactions([]); setDupCandidates([]);
        refresh();
      }
    } catch (err) {
      console.error("[add-expense] Error:", err);
    } finally {
      setAddLoading(false);
    }
  };

  const handleBatchAdd = async () => {
    if (batchTransactions.length === 0) return;
    setBatchLoading(true);
    let added = 0;
    for (const tx of batchTransactions) {
      if (!tx.payee || !tx.amount) continue;
      try {
        const res = await fetch("/api/ynab/transaction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: tx.account_id, amount: tx.amount.replace(",", "."), payee_name: tx.payee, date: tx.date }),
        });
        if (res.ok) added++;
      } catch { /* skip */ }
    }
    console.info("[add-expense] Batch added", added);
    setBatchTransactions([]); setReceiptPreview(null);
    onOpenChange(false); setBatchLoading(false);
    refresh();
  };

  const handleClose = (v: boolean) => {
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{locale === "fi" ? "Lisää puuttuva kulu" : "Add missing expense"}</DialogTitle>
        </DialogHeader>
        <div className="form-stack">
          <div className="settings-row">
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleReceiptUpload} hidden />
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={receiptParsing} className="w-full">
              {receiptParsing ? <Loader2 className="icon-sm animate-spin" /> : <Paperclip className="icon-sm" />}
              {receiptParsing ? (locale === "fi" ? "Luetaan..." : "Reading...") : (locale === "fi" ? "Liitä kuitti tai tiliote" : "Attach receipt or statement")}
            </Button>
          </div>

          {receiptPreview && (
            receiptType === "application/pdf"
              ? <object data={receiptPreview} type="application/pdf" className="receipt-preview-pdf">{/* PDF */}</object>
              : <img src={receiptPreview} alt="Receipt" className="receipt-preview" />
          )}

          {batchTransactions.length > 0 ? (
            <>
              <p className="settings-help">{batchTransactions.length} {locale === "fi" ? "tapahtumaa tunnistettu" : "transactions detected"}</p>
              <div className="batch-list">
                {batchTransactions.map((tx, i) => (
                  <div key={i} className="batch-item">
                    <div className="batch-item-info">
                      <p className="batch-item-payee">{tx.payee}</p>
                      <p className="batch-item-meta">{tx.amount} € · {tx.date === new Date().toISOString().slice(0, 10) ? (locale === "fi" ? "tänään" : "today") : (() => { const [y, m, d] = tx.date.split("-"); return `${parseInt(d)}.${parseInt(m)}.${y}`; })()} · {tx.account_name}</p>
                    </div>
                    <div className="batch-item-actions">
                      {allAccounts.length > 1 && (
                        <select value={tx.account_id} onChange={(e) => {
                          const acc = allAccounts.find((a) => a.id === e.target.value);
                          setBatchTransactions((prev) => prev.map((t, j) => j === i ? { ...t, account_id: e.target.value, account_name: acc?.name || "" } : t));
                        }} className="batch-account-select">
                          {allAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      )}
                      <button type="button" className="batch-remove-btn" onClick={() => setBatchTransactions((prev) => prev.filter((_, j) => j !== i))}>
                        <X />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <Button type="button" onClick={handleBatchAdd} disabled={batchLoading || batchTransactions.length === 0}>
                {batchLoading ? (locale === "fi" ? "Lisätään..." : "Adding...") : (locale === "fi" ? `Lisää ${batchTransactions.length} tapahtumaa` : `Add ${batchTransactions.length} transactions`)}
              </Button>
            </>
          ) : (
            <>
              {linkedAccountName && (
                <p className="settings-help">{locale === "fi" ? "Tili" : "Account"}: {linkedAccountName}</p>
              )}
              <div className="form-field">
                <Label>{locale === "fi" ? "Saaja" : "Payee"}</Label>
                <PayeeInput value={addPayee} onChange={setAddPayee} payees={payees} placeholder={locale === "fi" ? "esim. K-Market" : "e.g. Store name"} />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Summa (€)" : "Amount (€)"}</Label>
                <Input type="text" inputMode="decimal" value={addAmount} onChange={(e) => { setAddAmount(e.target.value); setDupCandidates([]); }} placeholder="0.00" />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Kuvaus" : "Description"}</Label>
                <Input value={addMemo} onChange={(e) => setAddMemo(e.target.value)} onBlur={() => resolveAccountFromMemo(addMemo)} placeholder={locale === "fi" ? "esim. bussikortti" : "e.g. bus card"} />
              </div>
              {dupCandidates.length > 0 && (
                <div className="dup-warning">
                  <p className="dup-warning-title">
                    {locale === "fi"
                      ? "Samansuuruinen tapahtuma löytyi jo - mahdollinen tuplaus:"
                      : "A transaction with the same amount already exists - possible duplicate:"}
                  </p>
                  {dupCandidates.map((d) => (
                    <p key={d.id} className="dup-warning-row">
                      {d.payee || (locale === "fi" ? "Tuntematon" : "Unknown")}
                      {d.account ? ` · ${d.account}` : ""} · {dayLabel(d.date, locale)}
                    </p>
                  ))}
                  <div className="dup-warning-actions">
                    <Button type="button" size="sm" variant="destructive" onClick={() => handleAddExpense(true)} disabled={addLoading}>
                      {locale === "fi" ? "Lisää silti" : "Add anyway"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setDupCandidates([])}>
                      {locale === "fi" ? "Peruuta" : "Cancel"}
                    </Button>
                  </div>
                </div>
              )}
              {dupCandidates.length === 0 && (
                <Button type="button" onClick={() => handleAddExpense()} disabled={addLoading || !linkedAccountId || !addAmount || !addPayee}>
                  {addLoading ? (locale === "fi" ? "Lisätään..." : "Adding...") : (locale === "fi" ? "Lisää" : "Add")}
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
