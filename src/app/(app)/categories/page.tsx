"use client";

import { useState, useEffect, useRef } from "react";
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
import { Plus, Loader2 } from "lucide-react";

interface Category {
  id: number;
  name: string;
  group_name: string;
  sort_order: number;
  color: string;
  is_active: number;
}

export default function CategoriesPage() {
  const { locale } = useLocale();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Category | null>(null);
  const addFormRef = useRef<HTMLFormElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);

  const load = () => {
    console.debug("[categories] Loading");
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => {
        if (data.categories) setCategories(data.categories);
      })
      .catch((err) => console.error("[categories] Load error:", err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = addFormRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const body = {
      name: fd.get("name") as string,
      group_name: fd.get("group_name") as string,
    };
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setAddOpen(false);
        form.reset();
        load();
      } else {
        const data = await res.json();
        alert(data.error || "Failed");
      }
    } catch (err) {
      console.error("[categories] Add error:", err);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editFormRef.current) return;
    const fd = new FormData(editFormRef.current);
    const body = {
      id: editTarget.id,
      name: fd.get("name") as string,
      group_name: fd.get("group_name") as string,
    };
    try {
      const res = await fetch("/api/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditOpen(false);
        setEditTarget(null);
        load();
      } else {
        const data = await res.json();
        alert(data.error || "Failed");
      }
    } catch (err) {
      console.error("[categories] Edit error:", err);
    }
  };

  const toggleActive = async (cat: Category) => {
    setCategories((prev) => prev.map((c) => c.id === cat.id ? { ...c, is_active: c.is_active ? 0 : 1 } : c));
    try {
      await fetch("/api/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cat.id, is_active: !cat.is_active }),
      });
    } catch (err) {
      console.error("[categories] Toggle error:", err);
    }
  };

  const deleteCategory = async (id: number) => {
    try {
      await fetch("/api/categories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setCategories((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error("[categories] Delete error:", err);
    }
  };

  // Group categories by group_name for display
  const groups = new Map<string, Category[]>();
  for (const c of categories) {
    const g = c.group_name || (locale === "fi" ? "Ei ryhmää" : "No group");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(c);
  }

  if (loading) {
    return <div className="page-loading"><Loader2 className="page-loading-spinner animate-spin" /></div>;
  }

  return (
    <div className="page-stack">
      <div className="page-header-row">
        <div>
          <h1 className="page-heading">{locale === "fi" ? "Kategoriat" : "Categories"}</h1>
          <p className="page-subtitle">{locale === "fi" ? "Hallinnoi kuluvientien kategorioita" : "Manage spending categories"}</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="icon-sm" />
            {locale === "fi" ? "Lisää kategoria" : "Add category"}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{locale === "fi" ? "Uusi kategoria" : "New category"}</DialogTitle></DialogHeader>
            <form ref={addFormRef} onSubmit={handleAdd} className="form-stack">
              <div className="form-field">
                <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
                <Input name="name" required autoComplete="off" />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Ryhmä" : "Group"}</Label>
                <Input name="group_name" placeholder={locale === "fi" ? "esim. Kiinteät kulut" : "e.g. Fixed costs"} autoComplete="off" />
              </div>
              <Button type="submit">{locale === "fi" ? "Lisää" : "Add"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {[...groups.entries()].map(([groupName, items]) => (
        <Card key={groupName} className="list-card list-card-divider">
          <p className="list-group-header">{groupName}</p>
          {items.map((c) => (
            <div
              key={c.id}
              className="list-item"
              onClick={() => { setEditTarget(c); setEditOpen(true); }}
            >
              <div className="list-item-body">
                <p className={`list-item-name ${!c.is_active ? "is-inactive" : ""}`}>{c.name}</p>
              </div>
              <div className="list-item-end">
                <span onClick={(e) => e.stopPropagation()}>
                  <Switch checked={!!c.is_active} onCheckedChange={() => toggleActive(c)} />
                </span>
              </div>
            </div>
          ))}
        </Card>
      ))}

      {categories.length === 0 && (
        <p className="page-subtitle">{locale === "fi" ? "Ei vielä kategorioita." : "No categories yet."}</p>
      )}

      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "fi" ? "Muokkaa kategoriaa" : "Edit category"}</DialogTitle></DialogHeader>
          {editTarget && (
            <form ref={editFormRef} onSubmit={handleEdit} className="form-stack">
              <div className="form-field">
                <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
                <Input name="name" defaultValue={editTarget.name} required autoComplete="off" />
              </div>
              <div className="form-field">
                <Label>{locale === "fi" ? "Ryhmä" : "Group"}</Label>
                <Input name="group_name" defaultValue={editTarget.group_name} autoComplete="off" />
              </div>
              <div className="form-grid-2">
                <Button type="button" variant="destructive" onClick={() => { deleteCategory(editTarget.id); setEditOpen(false); }}>
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
