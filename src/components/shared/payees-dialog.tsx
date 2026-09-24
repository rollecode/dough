"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Sparkles, Pencil, Check } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { useYnab } from "@/lib/ynab-context";

interface Usage {
  payee: string;
  uses: number;
}

interface MergeGroup {
  into: string;
  from: string[];
}

interface PayeesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Every payee in the ledger, most used first: rename one, merge several into one, or let the quick
// AI model find the same merchant written several ways. Nothing merges until a group is accepted.
export function PayeesDialog({ open, onOpenChange }: PayeesDialogProps) {
  const { locale } = useLocale();
  const { refresh } = useYnab();
  const fi = locale === "fi";
  const [usage, setUsage] = useState<Usage[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [suggestions, setSuggestions] = useState<MergeGroup[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fetchUsage = useCallback(
    () => fetch("/api/payees").then((r) => r.json()).then((d) => (Array.isArray(d.usage) ? (d.usage as Usage[]) : [])).catch(() => []),
    []
  );
  const load = useCallback(async () => setUsage(await fetchUsage()), [fetchUsage]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchUsage().then((list) => { if (alive) setUsage(list); });
    return () => { alive = false; };
  }, [open, fetchUsage]);

  // Closing forgets the selection and the suggestions, so the next opening starts clean.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setSelected([]);
      setSuggestions(null);
      setRenaming(null);
      setError("");
    }
    onOpenChange(next);
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? usage.filter((u) => u.payee.toLowerCase().includes(q)) : usage;
  }, [usage, query]);

  // The most used of the selected names is the one the others become, as a person would pick.
  const target = useMemo(
    () => usage.find((u) => selected.includes(u.payee))?.payee ?? "",
    [usage, selected]
  );

  async function merge(from: string[], into: string) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/payees/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, into }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setError(data.error || (fi ? "Yhdistäminen epäonnistui" : "Merging failed"));
      return false;
    }
    setSelected([]);
    setRenaming(null);
    setSuggestions((groups) => groups?.filter((g) => g.into !== into) ?? null);
    await load();
    await refresh();
    return true;
  }

  async function suggest() {
    setSuggesting(true);
    const data = await fetch("/api/payees/merge-suggestions").then((r) => r.json()).catch(() => ({}));
    setSuggestions(Array.isArray(data.groups) ? data.groups : []);
    setSuggesting(false);
  }

  function toggle(payee: string) {
    setSelected((list) => (list.includes(payee) ? list.filter((p) => p !== payee) : [...list, payee]));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="payees-dialog">
        <DialogHeader>
          <DialogTitle>{fi ? "Saajat" : "Payees"}</DialogTitle>
        </DialogHeader>

        <div className="payees-toolbar">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={fi ? "Hae saajia..." : "Search payees..."}
          />
          <Button variant="outline" size="sm" onClick={suggest} disabled={suggesting}>
            {suggesting ? <Loader2 className="icon-sm animate-spin" /> : <Sparkles className="icon-sm" />}
            {fi ? "Ehdota yhdistämisiä" : "Suggest merges"}
          </Button>
        </div>

        {suggestions && (
          <div className="payees-suggestions">
            {suggestions.length === 0 ? (
              <p className="payees-note">{fi ? "Kaksoiskappaleita ei löytynyt." : "No duplicates found."}</p>
            ) : (
              suggestions.map((group) => (
                <div key={group.into} className="payees-suggestion">
                  <p className="payees-suggestion-text">
                    {group.from.join(", ")} → <strong>{group.into}</strong>
                  </p>
                  <Button size="sm" onClick={() => merge(group.from, group.into)} disabled={busy}>
                    {fi ? "Yhdistä" : "Merge"}
                  </Button>
                </div>
              ))
            )}
          </div>
        )}

        {error && <p className="payees-error">{error}</p>}

        <ul className="payees-list">
          {shown.map((u) => (
            <li key={u.payee} className="payees-row">
              <input
                type="checkbox"
                checked={selected.includes(u.payee)}
                onChange={() => toggle(u.payee)}
                aria-label={u.payee}
              />
              {renaming?.from === u.payee ? (
                <form
                  className="payees-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    merge([u.payee], renaming.to);
                  }}
                >
                  <Input value={renaming.to} onChange={(e) => setRenaming({ from: u.payee, to: e.target.value })} autoFocus />
                  <Button type="submit" size="sm" disabled={busy || !renaming.to.trim()} aria-label={fi ? "Tallenna" : "Save"}>
                    <Check className="icon-sm" />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="payees-name">{u.payee}</span>
                  <span className="payees-uses">{u.uses}</span>
                  <button
                    type="button"
                    className="payees-edit"
                    onClick={() => setRenaming({ from: u.payee, to: u.payee })}
                    aria-label={fi ? "Nimeä uudelleen" : "Rename"}
                  >
                    <Pencil />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>

        {selected.length >= 2 && (
          <div className="payees-merge-bar">
            <p className="payees-note">
              {fi ? `Yhdistä ${selected.length} saajaa nimelle` : `Merge ${selected.length} payees into`} <strong>{target}</strong>
            </p>
            <Button size="sm" onClick={() => merge(selected, target)} disabled={busy}>
              {fi ? "Yhdistä" : "Merge"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
