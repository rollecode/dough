"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Copy, Check } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { formatDate } from "@/lib/date-utils";
import { API_KEYS_CHANGED } from "./mcp-connect";

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
}

// Minting a key used to mean running scripts/create-api-key.ts on the machine that owns the
// database. This does the same from the browser, which is the only way a phone can be set up.
export function ApiKeysCard() {
  const { locale } = useLocale();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [canWrite, setCanWrite] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  // Held only until the page is left: the server keeps a hash, so this is the one chance to copy it.
  const [fresh, setFresh] = useState("");

  useEffect(() => {
    const load = () =>
      fetch("/api/api-keys")
        .then((response) => response.json())
        .then((data) => setKeys(data.keys ?? []))
        .catch(() => setKeys([]));
    load();
    // The MCP card mints keys too, and they belong in this list straight away.
    window.addEventListener(API_KEYS_CHANGED, load);
    return () => window.removeEventListener(API_KEYS_CHANGED, load);
  }, []);

  async function createKey() {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes: canWrite ? "read,write" : "read" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || (locale === "fi" ? "Avaimen luonti epäonnistui" : "Could not create the key"));
        return;
      }
      console.info("[settings] Created API key", data.key_prefix);
      setFresh(data.key);
      setCopied(false);
      setKeys((current) => [data, ...current]);
      setName("");
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: number) {
    const response = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    if (!response.ok) return;
    setKeys((current) => current.filter((key) => key.id !== id));
  }

  function scopeLabel(scopes: string) {
    if (scopes.includes("write")) return locale === "fi" ? "luku ja kirjoitus" : "read and write";
    return locale === "fi" ? "vain luku" : "read only";
  }

  return (
    <Card className="settings-card">
      <CardHeader>
        <CardTitle className="settings-card-title">
          <KeyRound />
          {locale === "fi" ? "API-avaimet" : "API keys"}
        </CardTitle>
      </CardHeader>
      <CardContent className="form-stack">
        <p className="settings-help">
          {locale === "fi"
            ? "Avaimella oma sovellus, kuten Dough iOS tai MCP-asiakas, pääsee talouteesi ilman selainkirjautumista. Kirjoitusoikeus sallii myös menojen lisäämisen."
            : "A key lets your own app, such as Dough for iOS or the MCP server, reach your finances without a browser session. Write access also allows adding expenses."}
        </p>

        {fresh && (
          <div className="api-key-fresh">
            <p className="api-key-fresh-note">
              {locale === "fi"
                ? "Kopioi avain nyt. Sitä ei näytetä uudelleen."
                : "Copy the key now. It is not shown again."}
            </p>
            <div className="api-key-fresh-row">
              <code className="api-key-value">{fresh}</code>
              <button
                type="button"
                className="button"
                data-variant="outline"
                data-size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(fresh);
                  setCopied(true);
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? (locale === "fi" ? "Kopioitu" : "Copied") : locale === "fi" ? "Kopioi" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <div className="form-field">
          <Label htmlFor="api-key-name">{locale === "fi" ? "Mihin avain tulee" : "What the key is for"}</Label>
          <Input
            id="api-key-name"
            className="settings-input"
            value={name}
            placeholder={locale === "fi" ? "Esimerkiksi Dough iOS" : "For example Dough for iOS"}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="settings-row">
          <Switch checked={canWrite} onCheckedChange={setCanWrite} />
          <span>{locale === "fi" ? "Salli kirjoitus" : "Allow writing"}</span>
        </div>

        <div className="settings-row">
          <button type="button" className="button" data-size="sm" onClick={createKey} disabled={creating}>
            {creating
              ? locale === "fi"
                ? "Luodaan"
                : "Creating"
              : locale === "fi"
                ? "Luo avain"
                : "Create key"}
          </button>
          {error && <span className="settings-error">{error}</span>}
        </div>

        {keys.length > 0 && (
          <ul className="api-key-list">
            {keys.map((key) => (
              <li key={key.id} className="api-key-row">
                <div className="api-key-details">
                  <span className="api-key-name">{key.name}</span>
                  <span className="api-key-meta">
                    <code>{key.key_prefix}…</code>
                    <Badge variant="outline">{scopeLabel(key.scopes)}</Badge>
                    <span>
                      {key.last_used_at
                        ? `${locale === "fi" ? "Käytetty" : "Used"} ${formatDate(new Date(key.last_used_at))}`
                        : locale === "fi"
                          ? "Ei vielä käytössä"
                          : "Not used yet"}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  className="button"
                  data-variant="outline"
                  data-size="sm"
                  onClick={() => revokeKey(key.id)}
                >
                  {locale === "fi" ? "Mitätöi" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
