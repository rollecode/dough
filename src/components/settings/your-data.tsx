"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Database } from "lucide-react";
import { useLocale } from "@/lib/locale-context";

// A copy of everything the household has, and the way out: deleting your account, which takes the
// whole household with it when you are its last member.
export function YourDataCard() {
  const { locale } = useLocale();
  const fi = locale === "fi";
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function deleteAccount() {
    setDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.status === 403) {
        setError(fi ? "Väärä salasana" : "Wrong password");
        return;
      }
      if (!response.ok) {
        setError(fi ? "Tilin poisto epäonnistui" : "Could not delete the account");
        return;
      }
      window.location.href = "/login";
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="settings-card">
      <CardHeader>
        <CardTitle className="settings-card-title">
          <Database />
          {fi ? "Tietosi" : "Your data"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="settings-help">
          {fi
            ? "Lataa koko talouden tiedot yhtenä SQLite-tiedostona. Samalla tiedostolla voit myös siirtyä omalle palvelimelle."
            : "Download all of the household's data as one SQLite file. The same file lets you move to your own server."}
        </p>
        <div className="settings-row">
          <a className="button" data-variant="outline" data-size="sm" href="/api/account/export" download>
            {fi ? "Lataa tiedot" : "Download data"}
          </a>
        </div>

        <p className="settings-help">
          {fi
            ? "Tilin poisto poistaa omat keskustelusi ja avaimesi. Jos olet talouden viimeinen jäsen, koko talous tietoineen poistetaan."
            : "Deleting your account removes your own chats and keys. If you are the household's last member, the whole household and its data are deleted."}
        </p>
        {confirming ? (
          <div className="form-field">
            <Label htmlFor="delete-account-password">{fi ? "Vahvista salasanalla" : "Confirm with your password"}</Label>
            <Input
              id="delete-account-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="settings-row">
              <Button type="button" variant="destructive" size="sm" disabled={!password || deleting} onClick={deleteAccount}>
                {fi ? "Poista tili lopullisesti" : "Delete account for good"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => { setConfirming(false); setPassword(""); setError(""); }}>
                {fi ? "Peruuta" : "Cancel"}
              </Button>
            </div>
            {error && <p className="settings-error">{error}</p>}
          </div>
        ) : (
          <div className="settings-row">
            <Button type="button" variant="destructive" size="sm" onClick={() => setConfirming(true)}>
              {fi ? "Poista tili" : "Delete account"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
