"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "@/lib/locale-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CategoryPicker } from "@/components/shared/category-picker";
import { Link2, X } from "lucide-react";

// Shared budget-link control for the finance modals (savings goals, subscriptions, debts,
// investments). Shows where the thing is linked in the budget as a clickable jump to
// /budget?cat=<id>, offers one-click unlink, and when unlinked offers a category picker that
// links immediately. All reads/writes go through /api/budget-links, so every modal links and
// unlinks the same way.

interface LinkedCategory {
  category_id: number;
  category_name: string;
  group_name: string;
}

export function BudgetLinkControl({
  linkType,
  targetId,
  onChanged,
}: {
  linkType: "savings_goal" | "subscription" | "bill" | "debt_account" | "investment_account";
  targetId: number | string;
  onChanged?: () => void;
}) {
  const { locale } = useLocale();
  const [link, setLink] = useState<LinkedCategory | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [categories, setCategories] = useState<{ id: number; name: string; group_name: string }[]>([]);
  const [picker, setPicker] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/budget-links?type=${linkType}&id=${encodeURIComponent(String(targetId))}`)
      .then((r) => r.json())
      .then((d) => setLink(d.category || null))
      .catch((err) => console.error("[budget-link] Load error:", err))
      .finally(() => setLoaded(true));
  }, [linkType, targetId]);

  useEffect(() => {
    load();
    fetch("/api/categories")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.categories)) {
          setCategories(
            d.categories
              .filter((c: { is_active: number }) => c.is_active)
              .map((c: { id: number; name: string; group_name: string }) => ({ id: c.id, name: c.name, group_name: c.group_name || "" }))
          );
        }
      })
      .catch(() => {});
  }, [load]);

  const setLinkTo = async (categoryId: number | null) => {
    setSaving(true);
    try {
      await fetch("/api/budget-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: linkType, id: targetId, category_id: categoryId }),
      });
      console.info("[budget-link]", categoryId ? "Linked" : "Unlinked", linkType, targetId);
      load();
      setPicker("");
      onChanged?.();
    } catch (err) {
      console.error("[budget-link] Save error:", err);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="form-field">
      <Label>{locale === "fi" ? "Budjettilinkki" : "Budget link"}</Label>
      {link ? (
        <div className="budget-link-row">
          <a className="budget-link-jump" href={`/budget?cat=${link.category_id}`}>
            <Link2 className="icon-xs" />
            <span className="goal-linked-name">
              {link.group_name ? `${link.group_name} / ` : ""}{link.category_name}
            </span>
          </a>
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setLinkTo(null)}>
            <X className="icon-xs" />
            {locale === "fi" ? "Poista linkitys" : "Unlink"}
          </Button>
        </div>
      ) : (
        <CategoryPicker
          value={picker}
          onChange={(name) => {
            setPicker(name);
            const cat = categories.find((c) => c.name === name);
            if (cat) setLinkTo(cat.id);
          }}
          categories={categories}
          placeholder={locale === "fi" ? "Linkitä budjettikategoriaan" : "Link to a budget category"}
          noneLabel={locale === "fi" ? "Ei linkitystä" : "No link"}
          searchPlaceholder={locale === "fi" ? "Hae..." : "Search..."}
        />
      )}
    </div>
  );
}
