"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocale } from "@/lib/locale-context";
import { isTransfer } from "@/lib/transaction-utils";
import { useYnab } from "@/lib/ynab-context";
import { useEvent } from "@/lib/use-events";
import { relativeDate } from "@/lib/date-utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  RefreshCw,
  Loader2,
  Plus,
} from "lucide-react";
import { AddExpenseDialog } from "@/components/shared/add-expense-dialog";
import { PayeeInput } from "@/components/shared/payee-input";
import { CategoryPicker } from "@/components/shared/category-picker";
import { F } from "@/components/ui/f";

type FilterType = "all" | "income" | "expenses" | "transfers";

export default function TransactionsPage() {
  const { t, locale, fmt } = useLocale();
  const { data, loading, connected, sync, refresh } = useYnab();

  // SSE: refresh when transactions are added
  useEvent("data:updated", useCallback((d: unknown) => {
    const evt = d as { source?: string };
    if (evt.source === "transaction-added" || evt.source === "ynab-sync") {
      refresh();
    }
  }, [refresh]));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [allAccounts, setAllAccounts] = useState<{ id: string; name: string }[]>([]);
  const [budgetCats, setBudgetCats] = useState<{ name: string; group_name: string; available: number }[]>([]);
  const [payees, setPayees] = useState<string[]>([]);
  const [editTx, setEditTx] = useState<{ id: string; payee: string; amount: number; category: string; memo: string | null; account_id: string; date: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [splitLines, setSplitLines] = useState<{ category: string; amount: string }[]>([]);
  const [visibleCount, setVisibleCount] = useState(50);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Load accounts and categories for the edit dialog
  useEffect(() => {
    fetch("/api/ynab/accounts").then((r) => r.json()).then((data) => {
      if (data.accounts) setAllAccounts(data.accounts.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })));
    }).catch(() => {});
    fetch("/api/payees").then((r) => r.json()).then((data) => {
      if (Array.isArray(data.payees)) setPayees(data.payees);
    }).catch(() => {});
    // Budget categories with their available amounts, for the category picker.
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    fetch(`/api/budget?month=${ym}`).then((r) => r.json()).then((data) => {
      if (Array.isArray(data.categories)) {
        setBudgetCats(data.categories.filter((c: { is_active: number }) => c.is_active).map((c: { name: string; group_name: string; available: number }) => ({ name: c.name, group_name: c.group_name, available: c.available })));
      }
    }).catch(() => {});
  }, []);

  const handleEditSave = async () => {
    if (!editTx) return;
    setEditSaving(true);
    try {
      // Split mode (2+ lines): save the split; a single line saves as a normal edit.
      const usableSplits = splitLines.filter((l) => parseFloat(l.amount) > 0);
      if (splitMode && usableSplits.length >= 2) {
        const res = await fetch("/api/ynab/transaction/split", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction_id: editTx.id,
            splits: usableSplits.map((l) => ({ category: l.category, amount: parseFloat(l.amount) })),
          }),
        });
        const result = await res.json();
        if (result.success) { console.info("[transactions] Split saved for", editTx.id); setEditTx(null); refresh(); }
        else console.error("[transactions] Split failed:", result.error);
        return;
      }
      const res = await fetch("/api/ynab/transaction", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: editTx.id,
          amount: Math.abs(parseFloat(String(editTx.amount))),
          payee_name: editTx.payee,
          memo: editTx.memo || "",
          account_id: editTx.account_id,
          date: editTx.date,
          category: splitMode ? (usableSplits[0]?.category ?? editTx.category) : editTx.category,
        }),
      });
      const result = await res.json();
      if (result.success) {
        console.info("[transactions] Edit saved for", editTx.id);
        setEditTx(null);
        refresh();
      } else {
        console.error("[transactions] Edit failed:", result.error);
      }
    } catch (err) {
      console.error("[transactions] Edit save error:", err);
    } finally {
      setEditSaving(false);
    }
  };

  const filterLabels: Record<FilterType, string> = {
    all: t.transactions.all,
    expenses: t.transactions.expenses,
    income: t.transactions.income,
    transfers: locale === "fi" ? "Siirrot" : "Transfers",
  };

  const transactions = data?.transactions ?? [];

  // Fold split rows (sharing a split_group) into one entry showing the total and its parts.
  const entries = (() => {
    const groups = new Map<string, typeof transactions>();
    const out: (typeof transactions[number] & { isSplit?: boolean; parts?: { category: string; amount: number }[] })[] = [];
    for (const tx of transactions) {
      if (tx.split_group) {
        const arr = groups.get(tx.split_group) ?? [];
        arr.push(tx);
        groups.set(tx.split_group, arr);
      } else {
        out.push(tx);
      }
    }
    for (const [gid, rows] of groups) {
      const parent = rows.find((r) => r.id === gid) ?? rows[0];
      const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
      out.push({ ...parent, amount: total, isSplit: true, parts: rows.map((r) => ({ category: r.category, amount: r.amount })) });
    }
    return out;
  })();

  const filtered = entries
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((tx) => {
      const partMatch = tx.parts?.some((p) => p.category.toLowerCase().includes(search.toLowerCase()));
      if (search && !tx.payee.toLowerCase().includes(search.toLowerCase()) && !tx.category.toLowerCase().includes(search.toLowerCase()) && !partMatch) {
        return false;
      }
      const txIsTransfer = isTransfer(tx.payee, tx.category);
      if (filter === "income" && (tx.amount < 0 || txIsTransfer)) return false;
      if (filter === "expenses" && (tx.amount >= 0 || txIsTransfer)) return false;
      if (filter === "transfers" && !txIsTransfer) return false;
      if (filter === "all" && txIsTransfer) return false;
      return true;
    });

  // Infinite scroll: reset the window when filter/search changes, grow it as the sentinel scrolls into view
  useEffect(() => { setVisibleCount(50); }, [search, filter]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setVisibleCount((c) => c + 50); },
      { rootMargin: "300px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [filtered.length]);

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <div>
          <h1 className="page-heading">{t.transactions.title}</h1>
          <p className="page-subtitle">{connected ? t.transactions.subtitle : (locale === "fi" ? "Kaikki tapahtumasi" : "All your transactions")}</p>
        </div>
        <div className="sync-row">
          {connected && (
            <Button variant="outline" size="sm" onClick={() => sync()} disabled={loading}>
              <RefreshCw className={loading ? "icon-sm animate-spin" : "icon-sm"} />
            </Button>
          )}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="icon-sm" />
            {locale === "fi" ? "Lisää kulu" : "Add expense"}
          </Button>
          <AddExpenseDialog open={addOpen} onOpenChange={setAddOpen} />
        </div>
      </div>

      <div className="filter-bar">
        <div className="filter-bar-search">
          <Search className="filter-bar-search-icon" />
          <Input
            type="search"
            placeholder={t.transactions.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-with-icon"
          />
        </div>
        <div className="filter-bar-buttons">
          {(["all", "expenses", "income", "transfers"] as FilterType[]).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {filterLabels[f]}
            </Button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="page-loading">
          <Loader2 className="page-loading-spinner animate-spin" />
        </div>
      ) : (
        <Card className="list-card list-card-divider">
          {filtered.slice(0, visibleCount).map((tx) => {
            const txIsTransfer = isTransfer(tx.payee, tx.category);
            const openEdit = () => {
              setEditTx({ id: tx.id, payee: tx.payee, amount: tx.amount, category: tx.category, memo: tx.memo, account_id: tx.account_id || "", date: tx.date });
              if (tx.isSplit && tx.parts) {
                setSplitMode(true);
                setSplitLines(tx.parts.map((p) => ({ category: p.category, amount: String(Math.abs(p.amount)) })));
              } else {
                setSplitMode(false);
                setSplitLines([]);
              }
            };
            return (
            <div
              key={tx.id}
              className="list-item is-clickable"
              role="button"
              tabIndex={0}
              onClick={openEdit}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEdit(); } }}
            >
              <div className="list-item-icon" data-color={txIsTransfer ? "chart-3" : tx.amount < 0 ? "negative" : "positive"}>
                {tx.amount < 0 ? <ArrowUpRight className="icon-sm" /> : <ArrowDownLeft className="icon-sm" />}
              </div>
              <div className="list-item-body">
                <div className="list-item-name-row">
                  <p className="list-item-name">{tx.payee}</p>
                  {txIsTransfer && <Badge variant="secondary">{locale === "fi" ? "Siirto" : "Transfer"}</Badge>}
                  {tx.isSplit && <Badge variant="secondary">{locale === "fi" ? "Jaettu" : "Split"}</Badge>}
                </div>
                <p className="list-item-meta">{(() => {
                  const acct = allAccounts.find((a) => a.id === tx.account_id)?.name || "";
                  const cat = tx.isSplit && tx.parts
                    ? tx.parts.map((p) => p.category || (locale === "fi" ? "Ei kategoriaa" : "No category")).join(" · ")
                    : tx.category;
                  return [acct, cat].filter(Boolean).join(" · ");
                })()}</p>
              </div>
              <div className="list-item-amount">
                <p className="list-item-amount-value" data-positive={tx.amount >= 0 || undefined}>
                  {tx.amount < 0 ? <>-<F v={Math.abs(tx.amount)} /></> : <>+<F v={Math.abs(tx.amount)} /></>}
                </p>
                <p className="list-item-amount-date">{relativeDate(tx.date, locale)}</p>
              </div>
            </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="list-empty">
              <p>{locale === "fi" ? "Ei tapahtumia" : "No transactions"}</p>
            </div>
          )}
          {visibleCount < filtered.length && <div ref={sentinelRef} className="infinite-sentinel" aria-hidden="true" />}
        </Card>
      )}

      {/* Edit transaction dialog */}
      <Dialog open={!!editTx} onOpenChange={(open) => { if (!open) setEditTx(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locale === "fi" ? "Muokkaa tapahtumaa" : "Edit transaction"}</DialogTitle>
          </DialogHeader>
          {editTx && (
            <div className="form-stack">
              <div className="form-field">
                <Label>{locale === "fi" ? "Saaja" : "Payee"}</Label>
                <PayeeInput value={editTx.payee} onChange={(v) => setEditTx({ ...editTx, payee: v })} payees={payees} />
              </div>
              <div className="form-grid-2">
                <div className="form-field">
                  <Label>{locale === "fi" ? "Summa" : "Amount"}</Label>
                  <Input type="number" step="0.01" value={Math.abs(editTx.amount)} onChange={(e) => setEditTx({ ...editTx, amount: editTx.amount < 0 ? -Math.abs(parseFloat(e.target.value) || 0) : Math.abs(parseFloat(e.target.value) || 0) })} />
                </div>
                <div className="form-field">
                  <Label>{locale === "fi" ? "Päivämäärä" : "Date"}</Label>
                  <DateField value={editTx.date} onChange={(v) => setEditTx({ ...editTx, date: v })} />
                </div>
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Tili" : "Account"}</Label>
                <select className="input" value={editTx.account_id} onChange={(e) => setEditTx({ ...editTx, account_id: e.target.value })}>
                  <option value="">{locale === "fi" ? "Valitse tili" : "Select account"}</option>
                  {allAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              {!splitMode ? (
                <div className="form-field">
                  <div className="tx-split-head">
                    <Label>{locale === "fi" ? "Kategoria" : "Category"}</Label>
                    <button type="button" className="tx-split-toggle" onClick={() => { setSplitMode(true); setSplitLines([{ category: editTx.category, amount: String(Math.abs(editTx.amount)) }, { category: "", amount: "" }]); }}>
                      {locale === "fi" ? "Jaa kategorioihin" : "Split into categories"}
                    </button>
                  </div>
                  <CategoryPicker
                    value={editTx.category}
                    onChange={(v) => setEditTx({ ...editTx, category: v })}
                    categories={budgetCats}
                    fmt={fmt}
                    placeholder={locale === "fi" ? "Valitse kategoria" : "Select category"}
                    noneLabel={locale === "fi" ? "Ei kategoriaa" : "No category"}
                    searchPlaceholder={locale === "fi" ? "Hae..." : "Search..."}
                  />
                </div>
              ) : (() => {
                const total = Math.round(Math.abs(editTx.amount) * 100) / 100;
                const sum = Math.round(splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0) * 100) / 100;
                const remaining = Math.round((total - sum) * 100) / 100;
                return (
                  <div className="form-field">
                    <div className="tx-split-head">
                      <Label>{locale === "fi" ? "Jako kategorioihin" : "Split across categories"}</Label>
                      <button type="button" className="tx-split-toggle" onClick={() => { setSplitMode(false); setSplitLines([]); }}>
                        {locale === "fi" ? "Poista jako" : "Remove split"}
                      </button>
                    </div>
                    {splitLines.map((line, i) => (
                      <div className="tx-split-line" key={i}>
                        <CategoryPicker
                          value={line.category}
                          onChange={(v) => setSplitLines(splitLines.map((l, j) => j === i ? { ...l, category: v } : l))}
                          categories={budgetCats}
                          fmt={fmt}
                          placeholder={locale === "fi" ? "Valitse" : "Select"}
                          noneLabel={locale === "fi" ? "Ei kategoriaa" : "No category"}
                          searchPlaceholder={locale === "fi" ? "Hae..." : "Search..."}
                        />
                        <Input className="tx-split-amount" type="number" step="0.01" inputMode="decimal" placeholder="0.00" value={line.amount} onChange={(e) => setSplitLines(splitLines.map((l, j) => j === i ? { ...l, amount: e.target.value } : l))} />
                        {splitLines.length > 2 && <button type="button" className="tx-split-remove" onClick={() => setSplitLines(splitLines.filter((_, j) => j !== i))} aria-label="Remove line">×</button>}
                      </div>
                    ))}
                    <div className="tx-split-foot">
                      <button type="button" className="tx-split-toggle" onClick={() => setSplitLines([...splitLines, { category: "", amount: remaining > 0 ? String(remaining) : "" }])}>
                        {locale === "fi" ? "+ Lisää rivi" : "+ Add split"}
                      </button>
                      <span className={`tx-split-remaining ${Math.abs(remaining) < 0.005 ? "is-ok" : "is-off"}`}>
                        {remaining === 0 ? (locale === "fi" ? "Täsmää" : "Balanced") : `${locale === "fi" ? "Jäljellä" : "Remaining"}: ${remaining.toFixed(2)} €`}
                      </span>
                    </div>
                  </div>
                );
              })()}
              <div className="form-field">
                <Label>{locale === "fi" ? "Kuvaus" : "Memo"}</Label>
                <Input value={editTx.memo || ""} onChange={(e) => setEditTx({ ...editTx, memo: e.target.value })} />
              </div>
              <Button onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? <Loader2 className="icon-sm animate-spin" /> : (locale === "fi" ? "Tallenna" : "Save")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
