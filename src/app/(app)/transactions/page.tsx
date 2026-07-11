"use client";

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/locale-context";
import { isTransfer, transferCategoryLabel, transferCounterpartName } from "@/lib/transaction-utils";
import { useYnab, type YnabTransaction } from "@/lib/ynab-context";
import { useEvent } from "@/lib/use-events";
import { relativeDate, dayHeading } from "@/lib/date-utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { AddExpenseDialog } from "@/components/shared/add-expense-dialog";
import { PayeeInput } from "@/components/shared/payee-input";
import { CategoryPicker } from "@/components/shared/category-picker";
import { F } from "@/components/ui/f";

type FilterType = "all" | "income" | "expenses" | "transfers";

// URL-friendly slug for an account name, e.g. "My Checking" -> "my-checking". Used so an account's
// transactions are deep-linkable at /transactions/<slug>.
export function accountSlug(name: string): string {
  return name.toLowerCase()
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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

export default function TransactionsPage() {
  const { t, locale, fmt } = useLocale();
  const { data, loading, connected, sync, refresh } = useYnab();
  const pathname = usePathname();
  const [month, setMonth] = useState<string>(thisMonth());
  // Transactions for the viewed month, loaded from the local table. The dashboard sync payload only
  // carries the current month, so navigating to older months fetches them here.
  const [monthTx, setMonthTx] = useState<YnabTransaction[]>([]);
  const loadMonth = useCallback((m: string) => {
    fetch(`/api/transactions/list?month=${m}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.transactions)) setMonthTx(d.transactions); })
      .catch((err) => console.error("[transactions] Load month error:", err));
  }, []);
  useEffect(() => { loadMonth(month); }, [month, loadMonth]);

  // Reload the viewed month when transactions change (add/edit/delete/sync).
  useEvent("data:updated", useCallback((d: unknown) => {
    const evt = d as { source?: string };
    if (["transaction-added", "transaction-updated", "transaction-deleted", "ynab-sync", "synci-sync"].includes(evt.source || "")) {
      loadMonth(month);
    }
  }, [loadMonth, month]));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [addDayDate, setAddDayDate] = useState("");
  const [allAccounts, setAllAccounts] = useState<{ id: string; name: string }[]>([]);
  const [excludedAccountIds, setExcludedAccountIds] = useState<string[]>([]);
  const [budgetCats, setBudgetCats] = useState<{ name: string; group_name: string; available: number }[]>([]);
  const [payees, setPayees] = useState<string[]>([]);
  const [memos, setMemos] = useState<string[]>([]);
  const [editTx, setEditTx] = useState<{ id: string; payee: string; amount: number; category: string; memo: string | null; account_id: string; date: string } | null>(null);
  const [editType, setEditType] = useState<"expense" | "income" | "transfer">("expense");
  const [editTransferTo, setEditTransferTo] = useState("");
  const [editExcluded, setEditExcluded] = useState(false);
  const [editSuggestions, setEditSuggestions] = useState<string[]>([]);
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
    fetch("/api/memos").then((r) => r.json()).then((data) => {
      if (Array.isArray(data.memos)) setMemos(data.memos);
    }).catch(() => {});
    // Budget categories with their available amounts, for the category picker.
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    fetch(`/api/budget?month=${ym}`).then((r) => r.json()).then((data) => {
      if (Array.isArray(data.categories)) {
        setBudgetCats(data.categories.filter((c: { is_active: number }) => c.is_active).map((c: { name: string; group_name: string; available: number }) => ({ name: c.name, group_name: c.group_name, available: c.available })));
      }
    }).catch(() => {});
    // Accounts excluded from the daily budget ("Pois päiväbudjetista"), so the header balance can
    // sum only the in-budget accounts.
    fetch("/api/household").then((r) => r.json()).then((data) => {
      if (data.settings?.budget_excluded_accounts) {
        try { setExcludedAccountIds(JSON.parse(data.settings.budget_excluded_accounts)); } catch {}
      }
    }).catch(() => {});
  }, []);

  // Account selection is a deep link at a pretty path (/transactions/<account-slug>, or /transactions
  // for all). Native history.pushState updates the URL and keeps usePathname in sync without
  // remounting, so the view stays put and the URL is shareable and restored on refresh.
  const selectAccount = (id: string) => {
    setAccountFilter(id);
    const acct = allAccounts.find((a) => a.id === id);
    const path = id === "all" || !acct ? "/transactions" : `/transactions/${accountSlug(acct.name)}`;
    window.history.pushState(null, "", path);
  };

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
        if (result.success) { console.info("[transactions] Split saved for", editTx.id); setEditTx(null); refresh(); loadMonth(month); }
        else console.error("[transactions] Split failed:", result.error);
        return;
      }
      // Income is stored positive (Ready to Assign); a transfer keeps its current sign and the
      // internal-transfer category; an expense keeps the picked category and stays negative.
      const inflow = editType === "income" ? true : editType === "transfer" ? editTx.amount >= 0 : false;
      const category = editType === "income"
        ? "Inflow: Ready to Assign"
        : editType === "transfer"
        ? "Internal transfer"
        : (splitMode ? (usableSplits[0]?.category ?? editTx.category) : editTx.category);
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
          category,
          inflow,
          transfer_account_id: editType === "transfer" && editTransferTo ? editTransferTo : undefined,
          budget_excluded: editExcluded,
        }),
      });
      const result = await res.json();
      if (result.success) {
        console.info("[transactions] Edit saved for", editTx.id);
        setEditTx(null);
        refresh(); loadMonth(month);
      } else {
        console.error("[transactions] Edit failed:", result.error);
      }
    } catch (err) {
      console.error("[transactions] Edit save error:", err);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editTx) return;
    if (!window.confirm(locale === "fi" ? "Poistetaanko tämä tapahtuma?" : "Delete this transaction?")) return;
    setEditSaving(true);
    try {
      const res = await fetch("/api/ynab/transaction", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: editTx.id }),
      });
      const result = await res.json();
      if (result.success) {
        console.info("[transactions] Deleted", editTx.id);
        setEditTx(null);
        refresh(); loadMonth(month);
      } else {
        console.error("[transactions] Delete failed:", result.error);
      }
    } catch (err) {
      console.error("[transactions] Delete error:", err);
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

  const transactions = monthTx;

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

  // Search matches payee, category, memo, split-part categories and the amount. A numeric query is
  // matched against the absolute amount formatted to cents, and a Finnish decimal comma is accepted
  // (12,50 -> 12.50), so "200" finds a 200 EUR transfer that has no matching text.
  const q = search.trim().toLowerCase();
  const qNum = q.replace(",", ".");
  const qIsNumeric = q !== "" && /^\d+(\.\d+)?$/.test(qNum);

  const filtered = entries
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((tx) => {
      if (search) {
        const partMatch = tx.parts?.some((p) => p.category.toLowerCase().includes(q));
        const amountMatch = qIsNumeric && Math.abs(tx.amount).toFixed(2).includes(qNum);
        const memoMatch = (tx.memo || "").toLowerCase().includes(q);
        if (!tx.payee.toLowerCase().includes(q) && !tx.category.toLowerCase().includes(q) && !partMatch && !amountMatch && !memoMatch) {
          return false;
        }
      }
      if (tx.date.slice(0, 7) !== month) return false;
      if (accountFilter !== "all" && tx.account_id !== accountFilter) return false;
      const txIsTransfer = isTransfer(tx.payee, tx.category);
      if (filter === "income" && (tx.amount < 0 || txIsTransfer)) return false;
      if (filter === "expenses" && (tx.amount >= 0 || txIsTransfer)) return false;
      if (filter === "transfers" && !txIsTransfer) return false;
      // "all" shows every transaction including transfers (they are still kept out of income/expense
      // stats via isTransfer elsewhere); otherwise a reclassified transfer would vanish from view.
      return true;
    });

  // The counterpart account id a transfer leg points at, resolved from its "Transfer : <account>"
  // payee, so opening a paired transfer pre-selects its real Vastatili instead of defaulting to
  // "no second account" (which, if saved, would strip the counterpart off a good transfer).
  const counterpartIdFor = (payee: string): string => {
    const name = transferCounterpartName(payee);
    if (!name) return "";
    return allAccounts.find((a) => a.name === name)?.id || "";
  };

  // Deep link from elsewhere (e.g. the budget activity popover): /transactions?tx=<id> opens that
  // transaction's editor directly, regardless of the current month/filter.
  useEffect(() => {
    if (!data?.transactions) return;
    const txId = new URLSearchParams(window.location.search).get("tx");
    if (!txId) return;
    const t = data.transactions.find((x) => x.id === txId);
    if (t) {
      setEditTx({ id: t.id, payee: t.payee, amount: t.amount, category: t.category, memo: t.memo, account_id: t.account_id || "", date: t.date });
      setEditType(isTransfer(t.payee, t.category) ? "transfer" : t.amount > 0 ? "income" : "expense");
      setEditTransferTo(isTransfer(t.payee, t.category) ? counterpartIdFor(t.payee) : "");
      setEditExcluded(!!t.excluded);
      setSplitMode(false);
      setSplitLines([]);
      window.history.replaceState({}, "", "/transactions");
    }
  }, [data]);

  // Rank likely categories for the edited transaction's payee/description so they appear first.
  useEffect(() => {
    if (!editTx) { setEditSuggestions([]); return; }
    const payee = editTx.payee.trim();
    const memo = (editTx.memo || "").trim();
    if (!payee && !memo) { setEditSuggestions([]); return; }
    fetch(`/api/categories/suggest?payee=${encodeURIComponent(payee)}&memo=${encodeURIComponent(memo)}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.categories)) setEditSuggestions(d.categories); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTx?.id]);

  // Deep link: /transactions/<account-slug> pre-selects that account once accounts have loaded.
  useEffect(() => {
    if (!allAccounts.length) return;
    const slug = pathname.startsWith("/transactions/") ? decodeURIComponent(pathname.slice("/transactions/".length)) : "";
    if (!slug) { setAccountFilter("all"); return; }
    const match = allAccounts.find((a) => accountSlug(a.name) === slug);
    if (match) setAccountFilter(match.id);
  }, [pathname, allAccounts]);

  // Infinite scroll: reset the window when filter/search changes, grow it as the sentinel scrolls into view
  useEffect(() => { setVisibleCount(50); }, [search, filter, accountFilter, month]);

  // Live account balances for the topbar box (selected account, or all checking/savings).
  const acctBalances = data?.summary?.accounts ?? [];
  const topBalance = accountFilter === "all"
    ? acctBalances.filter((a) => (a.type === "checking" || a.type === "savings") && !excludedAccountIds.includes(a.id)).reduce((s, a) => s + a.balance, 0)
    : (acctBalances.find((a) => a.id === accountFilter)?.balance ?? 0);
  const topBalanceLabel = accountFilter === "all"
    ? (locale === "fi" ? "Tilien saldo (budjetissa)" : "Accounts balance (in budget)")
    : (allAccounts.find((a) => a.id === accountFilter)?.name ?? "");
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
          <Button size="sm" onClick={() => { setAddDayDate(""); setAddOpen(true); }}>
            <Plus className="icon-sm" />
            {locale === "fi" ? "Lisää tilitapahtuma" : "Add transaction"}
          </Button>
          <AddExpenseDialog open={addOpen} onOpenChange={setAddOpen} initialDate={addDayDate || undefined} initialAccountId={accountFilter !== "all" ? accountFilter : undefined} />
        </div>
      </div>

      <div className="tx-topbar">
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
        <div className="tx-balance-box">
          <span className={`tx-balance-value ${topBalance < -0.005 ? "is-negative" : topBalance > 0.005 ? "is-positive" : ""}`}><F v={topBalance} s=" €" /></span>
          <span className="tx-balance-label">{topBalanceLabel}</span>
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

      {allAccounts.length > 1 && (
        <div className="budget-filterbar tx-account-filterbar">
          <button
            type="button"
            className={`budget-filter ${accountFilter === "all" ? "is-active" : ""}`}
            onClick={() => selectAccount("all")}
          >
            {locale === "fi" ? "Kaikki tilit" : "All accounts"}
          </button>
          {allAccounts.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`budget-filter ${accountFilter === a.id ? "is-active" : ""}`}
              onClick={() => selectAccount(a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}

      {loading && !data ? (
        <div className="page-loading">
          <Loader2 className="page-loading-spinner animate-spin" />
        </div>
      ) : (
        <Card className="list-card list-card-divider">
          {(() => { let lastDay = ""; return filtered.slice(0, visibleCount).map((tx) => {
            const txIsTransfer = isTransfer(tx.payee, tx.category);
            const showDay = tx.date !== lastDay;
            lastDay = tx.date;
            const openEdit = () => {
              setEditTx({ id: tx.id, payee: tx.payee, amount: tx.amount, category: tx.category, memo: tx.memo, account_id: tx.account_id || "", date: tx.date });
              setEditType(txIsTransfer ? "transfer" : tx.amount > 0 ? "income" : "expense");
              setEditTransferTo(txIsTransfer ? counterpartIdFor(tx.payee) : "");
              setEditExcluded(!!tx.excluded);
              if (tx.isSplit && tx.parts) {
                setSplitMode(true);
                setSplitLines(tx.parts.map((p) => ({ category: p.category, amount: String(Math.abs(p.amount)) })));
              } else {
                setSplitMode(false);
                setSplitLines([]);
              }
            };
            return (
            <Fragment key={tx.id}>
            {showDay && (
              <div className="list-group-header tx-day-header">
                <span>{dayHeading(tx.date, locale)}</span>
                <button
                  type="button"
                  className="tx-day-add"
                  onClick={() => { setAddDayDate(tx.date); setAddOpen(true); }}
                  aria-label={locale === "fi" ? "Lisää tapahtuma tähän päivään" : "Add a transaction for this day"}
                >
                  <Plus />
                </button>
              </div>
            )}
            <div
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
                  {tx.excluded && <Badge variant="secondary">{locale === "fi" ? "Ei budjetissa" : "Excluded"}</Badge>}
                </div>
                <p className="list-item-meta">{(() => {
                  const acct = allAccounts.find((a) => a.id === tx.account_id)?.name || "";
                  const cat = txIsTransfer
                    ? transferCategoryLabel(locale)
                    : tx.isSplit && tx.parts
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
            </Fragment>
            );
          }); })()}
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
              <div className="tx-type-toggle">
                {(["expense", "income", "transfer"] as const).map((ty) => (
                  <button
                    key={ty}
                    type="button"
                    className={`tx-type-btn ${editType === ty ? "is-active" : ""}`}
                    onClick={() => { setEditType(ty); if (ty !== "expense") { setSplitMode(false); setSplitLines([]); } }}
                  >
                    {ty === "expense" ? (locale === "fi" ? "Meno" : "Expense") : ty === "income" ? (locale === "fi" ? "Tulo" : "Income") : (locale === "fi" ? "Siirto" : "Transfer")}
                  </button>
                ))}
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Saaja" : "Payee"}</Label>
                <PayeeInput value={editTx.payee} onChange={(v) => setEditTx({ ...editTx, payee: v })} payees={payees} onPick={() => document.getElementById("edit-tx-amount")?.focus()} />
              </div>
              <div className="form-grid-2">
                <div className="form-field">
                  <Label>{locale === "fi" ? "Summa" : "Amount"}</Label>
                  <Input id="edit-tx-amount" type="number" step="0.01" value={Math.abs(editTx.amount)} onChange={(e) => setEditTx({ ...editTx, amount: editTx.amount < 0 ? -Math.abs(parseFloat(e.target.value) || 0) : Math.abs(parseFloat(e.target.value) || 0) })} onFocus={(e) => e.currentTarget.select()} />
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
              {editType === "transfer" ? (
                <div className="form-field">
                  <Label>{locale === "fi" ? "Vastatili" : "Counterpart account"}</Label>
                  <select className="input" value={editTransferTo} onChange={(e) => setEditTransferTo(e.target.value)}>
                    <option value="">{locale === "fi" ? "Ei toista tiliä (ulkoinen)" : "No second account (external)"}</option>
                    {allAccounts.filter((a) => a.id !== editTx.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <p className="settings-help">{locale === "fi" ? "Siirto näkyy molemmilla tileillä, kun vastatili on valittu. Ei lasketa kuluksi eikä tuloksi." : "When a counterpart account is picked, the transfer shows on both accounts. Excluded from spending and income."}</p>
                </div>
              ) : editType === "income" ? (
                <p className="settings-help">{locale === "fi" ? "Merkitty tuloksi (Budjetoimatta)." : "Marked as income (Ready to Assign)."}</p>
              ) : !splitMode ? (
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
                    suggestions={editSuggestions}
                    suggestionsLabel={locale === "fi" ? "Ehdotukset" : "Suggested"}
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
                <PayeeInput value={editTx.memo || ""} onChange={(v) => setEditTx({ ...editTx, memo: v })} payees={memos} placeholder={locale === "fi" ? "esim. bussikortti" : "e.g. bus card"} />
              </div>
              <div className="form-field">
                <div className="settings-row">
                  <Switch checked={editExcluded} onCheckedChange={setEditExcluded} />
                  <Label>{locale === "fi" ? "Jätä pois budjetista" : "Exclude from budget"}</Label>
                </div>
                <p className="settings-help">{locale === "fi" ? "Ei lasketa mihinkään budjettilukuun (päiväbudjetti, kategoriat, kassavirta, tulot). Tilin saldo muuttuu silti." : "Left out of every budget figure (daily budget, categories, cash flow, income). The account balance still changes."}</p>
              </div>
              <div className="insp-actions">
                <Button onClick={handleEditSave} disabled={editSaving}>
                  {editSaving ? <Loader2 className="icon-sm animate-spin" /> : (locale === "fi" ? "Tallenna" : "Save")}
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={editSaving}>
                  {locale === "fi" ? "Poista" : "Delete"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
