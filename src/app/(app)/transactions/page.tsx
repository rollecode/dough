"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocale } from "@/lib/locale-context";
import { isTransfer } from "@/lib/transaction-utils";
import { useYnab } from "@/lib/ynab-context";
import { useEvent } from "@/lib/use-events";
import { relativeDate } from "@/lib/date-utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { F } from "@/components/ui/f";

type FilterType = "all" | "income" | "expenses" | "transfers";

export default function TransactionsPage() {
  const { t, locale } = useLocale();
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
  const [editTx, setEditTx] = useState<{ id: string; payee: string; amount: number; category: string; memo: string | null; account_id: string; date: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Load accounts for edit dialog
  useEffect(() => {
    fetch("/api/ynab/accounts").then((r) => r.json()).then((data) => {
      if (data.accounts) setAllAccounts(data.accounts.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })));
    }).catch(() => {});
  }, []);

  const handleEditSave = async () => {
    if (!editTx) return;
    setEditSaving(true);
    try {
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

  const filtered = transactions
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((tx) => {
      if (search && !tx.payee.toLowerCase().includes(search.toLowerCase()) && !tx.category.toLowerCase().includes(search.toLowerCase())) {
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

  if (!connected) {
    return (
      <div className="page-stack">
        <div>
          <h1 className="page-heading">{t.transactions.title}</h1>
          <p className="page-subtitle">{t.settings.ynabDescription}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <div>
          <h1 className="page-heading">{t.transactions.title}</h1>
          <p className="page-subtitle">{t.transactions.subtitle}</p>
        </div>
        <div className="sync-row">
          <Button variant="outline" size="sm" onClick={() => sync()} disabled={loading}>
            <RefreshCw className={loading ? "icon-sm animate-spin" : "icon-sm"} />
          </Button>
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
            return (
            <div key={tx.id} className="list-item is-clickable" onClick={() => setEditTx({ id: tx.id, payee: tx.payee, amount: tx.amount, category: tx.category, memo: tx.memo, account_id: tx.account_id || "", date: tx.date })}>
              <div className="list-item-icon" data-color={txIsTransfer ? "chart-3" : tx.amount < 0 ? "negative" : "positive"}>
                {tx.amount < 0 ? <ArrowUpRight className="icon-sm" /> : <ArrowDownLeft className="icon-sm" />}
              </div>
              <div className="list-item-body">
                <div className="list-item-name-row">
                  <p className="list-item-name">{tx.payee}</p>
                  {txIsTransfer && <Badge variant="secondary">{locale === "fi" ? "Siirto" : "Transfer"}</Badge>}
                </div>
                <p className="list-item-meta">{tx.category}</p>
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
                <Input value={editTx.payee} onChange={(e) => setEditTx({ ...editTx, payee: e.target.value })} />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Summa" : "Amount"}</Label>
                <Input type="number" step="0.01" value={Math.abs(editTx.amount)} onChange={(e) => setEditTx({ ...editTx, amount: editTx.amount < 0 ? -Math.abs(parseFloat(e.target.value) || 0) : Math.abs(parseFloat(e.target.value) || 0) })} />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Päivämäärä" : "Date"}</Label>
                <Input type="date" value={editTx.date} onChange={(e) => setEditTx({ ...editTx, date: e.target.value })} />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Tili" : "Account"}</Label>
                <select className="input" value={editTx.account_id} onChange={(e) => setEditTx({ ...editTx, account_id: e.target.value })}>
                  <option value="">{locale === "fi" ? "Valitse tili" : "Select account"}</option>
                  {allAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
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
