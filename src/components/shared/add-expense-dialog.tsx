"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Paperclip, X, Sparkles } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { useYnab } from "@/lib/ynab-context";
import { titleCasePayee } from "@/lib/text-utils";
import { PayeeInput } from "@/components/shared/payee-input";
import { CategoryPicker } from "@/components/shared/category-picker";
import { DateField } from "@/components/ui/date-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { F } from "@/components/ui/f";

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
  initialDate?: string;
  initialAccountId?: string;
}

export function AddExpenseDialog({ open, onOpenChange, initialDate, initialAccountId }: AddExpenseDialogProps) {
  const { locale, fmt } = useLocale();
  const { refresh, connected } = useYnab();
  // What kind of transaction is being added. Transfers only apply in local mode (YNAB manages its
  // own transfers), so the transfer tab is hidden when YNAB is connected.
  const [txType, setTxType] = useState<"expense" | "income" | "transfer">("expense");
  const [toAccountId, setToAccountId] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addPayee, setAddPayee] = useState("");
  const [addMemo, setAddMemo] = useState("");
  const [addCategory, setAddCategory] = useState("");
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 10));
  // Preselect a day when opened from a day heading's + button.
  useEffect(() => { if (open && initialDate) setAddDate(initialDate); }, [open, initialDate]);
  const [catGuessing, setCatGuessing] = useState(false);
  // Where the current category pick came from: AI suggestion or the user's own choice
  const [catSource, setCatSource] = useState<"" | "ai" | "manual">("");
  const catSourceRef = useRef<"" | "ai" | "manual">("");
  const [budgetCats, setBudgetCats] = useState<{ name: string; group_name: string; available: number }[]>([]);
  const [addLoading, setAddLoading] = useState(false);
  const [linkedAccountId, setLinkedAccountId] = useState("");
  const [linkedAccountName, setLinkedAccountName] = useState("");
  const [receiptParsing, setReceiptParsing] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptType, setReceiptType] = useState("");
  const [batchTransactions, setBatchTransactions] = useState<{ payee: string; amount: string; date: string; account_id: string; account_name: string; category: string; dup: boolean }[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [allAccounts, setAllAccounts] = useState<{ id: string; name: string }[]>([]);
  const [payees, setPayees] = useState<string[]>([]);
  const [memos, setMemos] = useState<string[]>([]);
  const [dupCandidates, setDupCandidates] = useState<{ id: string; date: string; payee: string; amount: number; account: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    console.debug("[add-expense] Loading accounts");
    fetch("/api/payees").then((r) => r.json()).then((d) => { if (Array.isArray(d.payees)) setPayees(d.payees); }).catch(() => {});
    fetch("/api/memos").then((r) => r.json()).then((d) => { if (Array.isArray(d.memos)) setMemos(d.memos); }).catch(() => {});
    const ym = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    fetch(`/api/budget?month=${ym}`).then((r) => r.json()).then((d) => {
      if (Array.isArray(d.categories)) setBudgetCats(d.categories.filter((c: { is_active: number }) => c.is_active).map((c: { name: string; group_name: string; available: number }) => ({ name: c.name, group_name: c.group_name, available: c.available })));
    }).catch(() => {});
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

  // Preselect the account when opened while the transactions list is filtered to one account.
  useEffect(() => {
    if (!open || !initialAccountId) return;
    setLinkedAccountId(initialAccountId);
    const a = allAccounts.find((x) => x.id === initialAccountId);
    if (a) setLinkedAccountName(a.name);
  }, [open, initialAccountId, allAccounts]);

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

  // Live AI category guess: as the payee/description are typed (debounced), ask the AI for the
  // best category and select it in the picker, marked as AI-chosen. A manual pick always wins -
  // once the user chooses, the AI stops updating the field.
  useEffect(() => {
    if (!open || txType !== "expense") return;
    const payee = addPayee.trim();
    if (!payee || catSourceRef.current === "manual") return;
    const t = setTimeout(async () => {
      setCatGuessing(true);
      try {
        const res = await fetch(`/api/categorize?payee=${encodeURIComponent(payee)}&memo=${encodeURIComponent(addMemo.trim())}`);
        const d = await res.json();
        if (d.category && catSourceRef.current !== "manual") {
          setAddCategory(d.category);
          catSourceRef.current = "ai";
          setCatSource("ai");
          console.debug("[add-expense] AI suggested category:", d.category);
        }
      } catch { /* ignore */ } finally {
        setCatGuessing(false);
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, addPayee, addMemo, txType]);

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
          const base = data.transactions.map((tx: { payee: string; amount: string; date?: string; account?: string }) => {
            const payee = titleCasePayee(tx.payee || "");
            let accId = linkedAccountId;
            let accName = linkedAccountName;
            if (tx.account) {
              const matched = allAccounts.find((a) => a.name === tx.account);
              if (matched) { accId = matched.id; accName = matched.name; }
            }
            return { payee, amount: tx.amount, date: tx.date || new Date().toISOString().slice(0, 10), account_id: accId, account_name: accName };
          });
          // Enrich each parsed line like the single-add flow does: guess a category (AI) and flag
          // likely duplicates - both against existing transactions and identical lines within this
          // same parse (a statement that lists the same charge twice, or the parser repeating one).
          const enriched = await Promise.all(base.map(async (tx: { payee: string; amount: string; date: string; account_id: string; account_name: string }, idx: number) => {
            const amt = Math.abs(parseFloat(String(tx.amount).replace(",", ".")));
            let category = "";
            try {
              const cr = await fetch(`/api/categorize?payee=${encodeURIComponent(tx.payee)}&memo=`);
              const cd = await cr.json();
              if (cd.category) category = cd.category;
            } catch { /* leave uncategorized; server still auto-cats on add */ }
            let dup = base.some((o: { payee: string; amount: string; date: string }, j: number) =>
              j < idx && o.date === tx.date && o.payee === tx.payee && Math.abs(parseFloat(String(o.amount).replace(",", "."))) === amt);
            if (!dup && isFinite(amt) && amt > 0) {
              try {
                const dr = await fetch(`/api/transactions/check-duplicate?amount=${amt}&date=${tx.date}`);
                const dd = await dr.json();
                if (Array.isArray(dd.duplicates) && dd.duplicates.length > 0) dup = true;
              } catch { /* non-blocking */ }
            }
            return { ...tx, category, dup };
          }));
          setBatchTransactions(enriched);
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
          const res = await fetch(`/api/transactions/check-duplicate?amount=${amountNum}&date=${addDate}`);
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
          // Income lands in Ready to Assign, so the category picker only applies to expenses.
          category: txType === "expense" ? (addCategory || undefined) : undefined,
          inflow: txType === "income",
          date: addDate,
        }),
      });
      if (res.ok) {
        onOpenChange(false);
        setAddAmount(""); setAddPayee(""); setAddMemo(""); setAddCategory(""); setAddDate(new Date().toISOString().slice(0, 10));
        setTxType("expense"); setToAccountId("");
        catSourceRef.current = ""; setCatSource("");
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
          body: JSON.stringify({ account_id: tx.account_id, amount: tx.amount.replace(",", "."), payee_name: tx.payee, category: tx.category || undefined, date: tx.date }),
        });
        if (res.ok) added++;
      } catch { /* skip */ }
    }
    console.info("[add-expense] Batch added", added);
    setBatchTransactions([]); setReceiptPreview(null);
    onOpenChange(false); setBatchLoading(false);
    refresh();
  };

  const handleAddTransfer = async (force = false) => {
    if (!linkedAccountId || !toAccountId || linkedAccountId === toAccountId || !addAmount) return;
    // Guard against re-entering a transfer that already exists (e.g. one Synci already imported as
    // an expense) - same amount on the source account today/tomorrow. Skipped on force.
    if (!force) {
      const amountNum = Math.abs(parseFloat(addAmount.replace(",", ".")));
      if (isFinite(amountNum) && amountNum > 0) {
        try {
          const res = await fetch(`/api/transactions/check-duplicate?amount=${amountNum}&date=${addDate}`);
          const d = await res.json();
          if (Array.isArray(d.duplicates) && d.duplicates.length > 0) {
            console.info("[add-expense] Possible duplicate transfer(s):", d.duplicates.length);
            setDupCandidates(d.duplicates);
            return;
          }
        } catch { /* if the check fails, do not block the transfer */ }
      }
    }
    setAddLoading(true);
    try {
      const res = await fetch("/api/transactions/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_account_id: linkedAccountId, to_account_id: toAccountId, amount: addAmount.replace(",", "."), memo: addMemo || undefined, date: addDate }),
      });
      if (res.ok) {
        onOpenChange(false);
        setAddAmount(""); setAddPayee(""); setAddMemo(""); setAddCategory(""); setAddDate(new Date().toISOString().slice(0, 10));
        setTxType("expense"); setToAccountId("");
        setReceiptPreview(null); setBatchTransactions([]); setDupCandidates([]);
        refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        console.error("[add-expense] Transfer error:", j.error);
      }
    } catch (err) {
      console.error("[add-expense] Transfer error:", err);
    } finally {
      setAddLoading(false);
    }
  };

  const handleClose = (v: boolean) => {
    onOpenChange(v);
  };

  // Value -> label map so the account Select shows the account name (not the raw id) even when the
  // value is set programmatically (the spending account is preselected from the profile).
  const accountItems: Record<string, string> = Object.fromEntries(allAccounts.map((a) => [a.id, a.name]));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{locale === "fi" ? "Lisää tilitapahtuma" : "Add transaction"}</DialogTitle>
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
                  <div key={i} className={`batch-item ${tx.dup ? "is-dup" : ""}`}>
                    <div className="batch-item-top">
                      <div className="batch-item-info">
                        <p className="batch-item-payee">
                          {tx.payee}
                          {tx.dup && <span className="batch-dup-chip">{locale === "fi" ? "mahdollinen duplikaatti" : "possible duplicate"}</span>}
                        </p>
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
                    <CategoryPicker
                      value={tx.category}
                      onChange={(v) => setBatchTransactions((prev) => prev.map((t, j) => j === i ? { ...t, category: v } : t))}
                      categories={budgetCats}
                      fmt={fmt}
                      placeholder={locale === "fi" ? "Valitse kategoria" : "Select category"}
                      noneLabel={locale === "fi" ? "Ei kategoriaa" : "No category"}
                      searchPlaceholder={locale === "fi" ? "Hae…" : "Search…"}
                    />
                  </div>
                ))}
              </div>
              <Button type="button" onClick={handleBatchAdd} disabled={batchLoading || batchTransactions.length === 0}>
                {batchLoading ? (locale === "fi" ? "Lisätään..." : "Adding...") : (locale === "fi" ? `Lisää ${batchTransactions.length} tapahtumaa` : `Add ${batchTransactions.length} transactions`)}
              </Button>
            </>
          ) : (
            <>
              {/* Transaction type: expense / income / transfer. Transfers only apply in local mode
                  (YNAB manages its own transfers), so the transfer tab is hidden with YNAB connected. */}
              <div className="tx-type-toggle">
                <button type="button" className={`tx-type-btn ${txType === "expense" ? "is-active" : ""}`} onClick={() => setTxType("expense")}>
                  {locale === "fi" ? "Meno" : "Expense"}
                </button>
                <button type="button" className={`tx-type-btn ${txType === "income" ? "is-active" : ""}`} onClick={() => setTxType("income")}>
                  {locale === "fi" ? "Tulo" : "Income"}
                </button>
                {!connected && (
                  <button type="button" className={`tx-type-btn ${txType === "transfer" ? "is-active" : ""}`} onClick={() => setTxType("transfer")}>
                    {locale === "fi" ? "Siirto" : "Transfer"}
                  </button>
                )}
              </div>

              <div className="form-field">
                <Label>{txType === "transfer" ? (locale === "fi" ? "Miltä tililtä" : "From account") : (locale === "fi" ? "Tili" : "Account")}</Label>
                <Select items={accountItems} value={linkedAccountId} onValueChange={(v) => { if (v) { setLinkedAccountId(v); const a = allAccounts.find((x) => x.id === v); setLinkedAccountName(a?.name || ""); } }}>
                  <SelectTrigger className="tx-account-trigger"><SelectValue placeholder={locale === "fi" ? "Valitse tili" : "Select account"} /></SelectTrigger>
                  <SelectContent>
                    {allAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {txType === "transfer" && (
                <div className="form-field">
                  <Label>{locale === "fi" ? "Mille tilille" : "To account"}</Label>
                  <Select items={accountItems} value={toAccountId} onValueChange={(v) => v && setToAccountId(v)}>
                    <SelectTrigger className="tx-account-trigger"><SelectValue placeholder={locale === "fi" ? "Valitse tili" : "Select account"} /></SelectTrigger>
                    <SelectContent>
                      {allAccounts.filter((a) => a.id !== linkedAccountId).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {txType !== "transfer" && (
                <div className="form-field">
                  <Label>{locale === "fi" ? "Saaja" : "Payee"}</Label>
                  <PayeeInput value={addPayee} onChange={setAddPayee} payees={payees} placeholder={locale === "fi" ? "esim. K-Market" : "e.g. Store name"} />
                </div>
              )}

              <div className="form-grid-2">
                <div className="form-field">
                  <Label>{locale === "fi" ? "Summa (€)" : "Amount (€)"}</Label>
                  <Input type="text" inputMode="decimal" value={addAmount} onChange={(e) => { setAddAmount(e.target.value); setDupCandidates([]); }} placeholder="0.00" />
                </div>
                <div className="form-field">
                  <Label>{locale === "fi" ? "Päivämäärä" : "Date"}</Label>
                  <DateField value={addDate} onChange={(v) => { setAddDate(v); setDupCandidates([]); }} />
                </div>
              </div>

              {txType === "expense" && (
                <div className="form-field">
                  <Label>
                    {locale === "fi" ? "Kategoria" : "Category"}
                    {catGuessing && <span className="ai-cat-badge is-thinking"><Sparkles /> {locale === "fi" ? "AI miettii…" : "AI thinking…"}</span>}
                    {!catGuessing && catSource === "ai" && addCategory && <span className="ai-cat-badge"><Sparkles /> {locale === "fi" ? "AI valitsi" : "AI picked"}</span>}
                  </Label>
                  <CategoryPicker
                    value={addCategory}
                    onChange={(v) => { setAddCategory(v); const src = v ? "manual" : ""; catSourceRef.current = src; setCatSource(src); }}
                    categories={budgetCats}
                    fmt={fmt}
                    placeholder={locale === "fi" ? "Valitse kategoria" : "Select category"}
                    noneLabel={locale === "fi" ? "Ei kategoriaa" : "No category"}
                    searchPlaceholder={locale === "fi" ? "Hae…" : "Search…"}
                  />
                </div>
              )}

              {txType === "income" && (
                <p className="settings-help">{locale === "fi" ? "Tulo lisätään Budjetoimatta-saldoon (Ready to Assign)." : "Income is added to Ready to Assign."}</p>
              )}

              <div className="form-field">
                <Label>{locale === "fi" ? "Kuvaus" : "Description"}</Label>
                <PayeeInput value={addMemo} onChange={setAddMemo} payees={memos} onBlur={() => txType !== "transfer" && resolveAccountFromMemo(addMemo)} placeholder={locale === "fi" ? "esim. bussikortti" : "e.g. bus card"} />
              </div>

              {dupCandidates.length > 0 && (
                <div className="dup-warning">
                  <p className="dup-warning-title">
                    {locale === "fi"
                      ? "Samansuuruinen tapahtuma on jo olemassa - mahdollinen duplikaatti:"
                      : "A transaction with the same amount already exists - possible duplicate:"}
                  </p>
                  {dupCandidates.map((d) => (
                    <div key={d.id} className="dup-warning-row">
                      <div className="dup-warning-row-body">
                        <span className="dup-warning-row-payee">{d.payee || (locale === "fi" ? "Tuntematon" : "Unknown")}</span>
                        <span className="dup-warning-row-meta">{[d.account, dayLabel(d.date, locale)].filter(Boolean).join(" · ")}</span>
                      </div>
                      <span className="dup-warning-row-amt" data-negative={d.amount < 0 || undefined}>
                        {d.amount < 0 ? "-" : "+"}<F v={Math.abs(d.amount)} s=" €" />
                      </span>
                    </div>
                  ))}
                  <div className="dup-warning-actions">
                    <Button type="button" size="sm" variant="destructive" onClick={() => (txType === "transfer" ? handleAddTransfer(true) : handleAddExpense(true))} disabled={addLoading}>
                      {locale === "fi" ? "Lisää silti" : "Add anyway"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setDupCandidates([])}>
                      {locale === "fi" ? "Peruuta" : "Cancel"}
                    </Button>
                  </div>
                </div>
              )}

              {dupCandidates.length === 0 && (txType === "transfer" ? (
                <Button type="button" onClick={() => handleAddTransfer()} disabled={addLoading || !linkedAccountId || !toAccountId || linkedAccountId === toAccountId || !addAmount}>
                  {addLoading ? (locale === "fi" ? "Siirretään..." : "Transferring...") : (locale === "fi" ? "Siirrä" : "Transfer")}
                </Button>
              ) : (
                <Button type="button" onClick={() => handleAddExpense()} disabled={addLoading || !linkedAccountId || !addAmount || !addPayee}>
                  {addLoading ? (locale === "fi" ? "Lisätään..." : "Adding...") : (locale === "fi" ? "Lisää" : "Add")}
                </Button>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
