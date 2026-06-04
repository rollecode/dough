"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, CheckCircle2, XCircle, Globe, Link, Loader2, PiggyBank, Users, Sparkles, User, Wallet } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";
import { F } from "@/components/ui/f";
import { DEFAULT_CHAT_GUIDELINES, DEFAULT_SUMMARY_INSTRUCTIONS, DEFAULT_DEBT_INSTRUCTIONS } from "@/lib/ai/default-prompts";

interface UserProfile {
  id: number;
  email: string;
  locale: string;
  ynab_connected: boolean;
  ynab_budget_id: string | null;
  last_ynab_sync: string | null;
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState("en");
  const [ynabToken, setYnabToken] = useState("");
  const [ynabBudgetId, setYnabBudgetId] = useState("");
  const [ynabLoading, setYnabLoading] = useState(false);
  const [ynabError, setYnabError] = useState("");
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState("");
  const [langSaved, setLangSaved] = useState(false);
  const [ynabBudgets, setYnabBudgets] = useState<{ id: string; name: string }[]>([]);
  const [budgetsLoading, setBudgetsLoading] = useState(false);
  const [savingRate, setSavingRate] = useState("");
  const [savingRateSaved, setSavingRateSaved] = useState(false);
  const [householdProfile, setHouseholdProfile] = useState("");
  const [householdSize, setHouseholdSize] = useState("1");
  const [householdSaved, setHouseholdSaved] = useState(false);
  const [prompts, setPrompts] = useState({ chat: DEFAULT_CHAT_GUIDELINES, summary: DEFAULT_SUMMARY_INSTRUCTIONS, debt: DEFAULT_DEBT_INSTRUCTIONS });
  const [promptSaved, setPromptSaved] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [allAccounts, setAllAccounts] = useState<{ id: string; name: string; balance: number }[]>([]);
  const [linkedAccountIds, setLinkedAccountIds] = useState<string[]>([]);
  const [excludedAccounts, setExcludedAccounts] = useState<string[]>([]);
  const [excludedSaved, setExcludedSaved] = useState(false);
  const [budgetBillsMode, setBudgetBillsMode] = useState("auto");
  const [reserveNextMonthSaving, setReserveNextMonthSaving] = useState(false);
  const [reserveSaved, setReserveSaved] = useState(false);
  const [ynabSyncHour, setYnabSyncHour] = useState("6");
  const [syncHourSaved, setSyncHourSaved] = useState(false);
  const [aiSummariesDisabled, setAiSummariesDisabled] = useState(false);
  const [aiSummariesSaved, setAiSummariesSaved] = useState(false);
  const [billsModeSaved, setBillsModeSaved] = useState(false);
  const [thresholds, setThresholds] = useState({ tight: "20", normal: "30", good: "50" });
  const [thresholdsSaved, setThresholdsSaved] = useState(false);
  const [accountsSaved, setAccountsSaved] = useState(false);
  const [accountNotes, setAccountNotes] = useState<Record<string, string>>({});
  const [notesSaved, setNotesSaved] = useState(false);
  const [personalBudgetShare, setPersonalBudgetShare] = useState("");
  const [personalShareSaved, setPersonalShareSaved] = useState(false);
  const [decimalPlaces, setDecimalPlaces] = useState("0");
  const [decimalSaved, setDecimalSaved] = useState(false);
  const [synciToken, setSynciToken] = useState("");
  const [synciSaved, setSynciSaved] = useState(false);
  const [synciConnected, setSynciConnected] = useState(false);
  const [synciAccounts, setSynciAccounts] = useState<{ id: string; iban: string; owner: string }[]>([]);
  const [synciMappings, setSynciMappings] = useState<Record<string, string>>({});
  const [synciMappingSaved, setSynciMappingSaved] = useState(false);
  const [synciLoading, setSynciLoading] = useState(false);
  const { t, locale, setLocale, setDecimals } = useLocale();

  useEffect(() => {
    console.debug("[settings] Loading settings");
    Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch("/api/household").then((r) => r.json()),
      fetch("/api/profile").then((r) => r.json()),
      fetch("/api/ynab/accounts").then((r) => r.json()).catch(() => ({ accounts: [] })),
      fetch("/api/account-notes").then((r) => r.json()).catch(() => ({ notes: {} })),
    ])
      .then(([userData, householdData, profileData, accountsData, notesData]) => {
        if (userData.user) {
          setProfile({
            ...userData.user,
            ynab_connected: householdData.settings?.ynab_connected || false,
            ynab_budget_id: householdData.settings?.ynab_budget_id || null,
            last_ynab_sync: householdData.settings?.last_ynab_sync || null,
          });
          setLanguage(userData.user.locale || "en");
          if (householdData.settings?.ynab_budget_id) {
            setYnabBudgetId(householdData.settings.ynab_budget_id);
          }
          if (householdData.settings?.saving_rate) {
            setSavingRate(String(householdData.settings.saving_rate));
          }
          if (householdData.settings?.household_profile) {
            setHouseholdProfile(householdData.settings.household_profile);
          }
          if (householdData.settings?.household_size) {
            setHouseholdSize(householdData.settings.household_size);
          }
          if (householdData.settings?.decimal_places !== undefined) {
            setDecimalPlaces(String(householdData.settings.decimal_places));
          }
          if (householdData.settings?.prompt_chat_guidelines) {
            setPrompts((p) => ({ ...p, chat: householdData.settings.prompt_chat_guidelines }));
          }
          if (householdData.settings?.prompt_summary_instructions) {
            setPrompts((p) => ({ ...p, summary: householdData.settings.prompt_summary_instructions }));
          }
          if (householdData.settings?.prompt_debt_instructions) {
            setPrompts((p) => ({ ...p, debt: householdData.settings.prompt_debt_instructions }));
          }
          if (householdData.settings?.budget_excluded_accounts) {
            try { setExcludedAccounts(JSON.parse(householdData.settings.budget_excluded_accounts)); } catch {}
          }
          if (householdData.settings?.budget_include_bills !== undefined) {
            setBudgetBillsMode(householdData.settings.budget_include_bills);
          }
          if (householdData.settings?.reserve_next_month_saving !== undefined) {
            setReserveNextMonthSaving(householdData.settings.reserve_next_month_saving === "1");
          }
          if (householdData.settings?.ynab_sync_hour !== undefined) {
            setYnabSyncHour(String(householdData.settings.ynab_sync_hour));
          }
          if (householdData.settings?.ai_summaries_disabled !== undefined) {
            setAiSummariesDisabled(householdData.settings.ai_summaries_disabled === "1");
          }
          if (householdData.settings?.budget_threshold_tight) setThresholds((p) => ({ ...p, tight: householdData.settings.budget_threshold_tight }));
          if (householdData.settings?.budget_threshold_normal) setThresholds((p) => ({ ...p, normal: householdData.settings.budget_threshold_normal }));
          if (householdData.settings?.budget_threshold_good) setThresholds((p) => ({ ...p, good: householdData.settings.budget_threshold_good }));
          if (householdData.settings?.synci_api_token) {
            setSynciConnected(true);
            setSynciToken("••••••••");
          }
          if (householdData.settings?.synci_accounts) {
            try { setSynciAccounts(JSON.parse(householdData.settings.synci_accounts)); } catch {}
          }
          if (householdData.settings?.synci_account_mapping) {
            try { setSynciMappings(JSON.parse(householdData.settings.synci_account_mapping)); } catch {}
          }
          if (profileData.profile) {
            setDisplayName(profileData.profile.display_name || "");
            if (profileData.profile.budget_share) setPersonalBudgetShare(String(profileData.profile.budget_share));
          }
          if (profileData.linkedAccountIds) {
            setLinkedAccountIds(profileData.linkedAccountIds);
          }
          if (accountsData.accounts) {
            setAllAccounts(accountsData.accounts);
          }
          if (notesData.notes) {
            setAccountNotes(notesData.notes);
          }
          if (householdData.settings?.ynab_connected) {
            fetch("/api/ynab/budgets")
              .then((r) => r.json())
              .then((bd) => {
                if (bd.budgets?.length) setYnabBudgets(bd.budgets);
              })
              .catch(() => {});
          }
        }
      })
      .catch((err) => console.error("[settings] Failed to load:", err))
      .finally(() => setLoading(false));
  }, []);

  const handleLanguageChange = async (value: string) => {
    setLanguage(value);
    setLocale(value as Locale);
    console.info("[settings] Saving language:", value);
    try {
      const res = await fetch("/api/auth/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: value }),
      });
      if (res.ok) {
        setLangSaved(true);
        setTimeout(() => setLangSaved(false), 2000);
        console.info("[settings] Language saved:", value);
      } else {
        console.error("[settings] Failed to save language");
      }
    } catch (err) {
      console.error("[settings] Language save error:", err);
    }
  };

  const fetchBudgets = async () => {
    setBudgetsLoading(true);
    try {
      const res = await fetch("/api/ynab/budgets");
      const data = await res.json();
      if (data.budgets?.length) {
        setYnabBudgets(data.budgets);
        return data.budgets as { id: string; name: string }[];
      }
    } catch (err) {
      console.error("[settings] Failed to fetch budgets:", err);
    } finally {
      setBudgetsLoading(false);
    }
    return [];
  };

  const handleYnabConnect = async () => {
    if (!ynabToken.trim()) {
      setYnabError("Token required");
      return;
    }
    setYnabLoading(true);
    setYnabError("");
    console.info("[settings] Connecting YNAB");

    try {
      // Save token to household settings
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ynab_access_token: ynabToken.trim() }),
      });

      if (!res.ok) {
        setYnabError("Failed to save token");
        console.error("[settings] YNAB token save failed");
        return;
      }

      setProfile((prev) => prev ? { ...prev, ynab_connected: true } : prev);
      setYnabToken("");
      console.info("[settings] YNAB token saved");

      // Fetch budgets and auto-select first one
      const budgets = await fetchBudgets();
      if (budgets.length > 0) {
        const firstBudget = budgets[0];
        setYnabBudgetId(firstBudget.id);
        await fetch("/api/household", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ynab_budget_id: firstBudget.id }),
        });
        setProfile((prev) => prev ? { ...prev, ynab_budget_id: firstBudget.id } : prev);
        console.info("[settings] Auto-selected budget:", firstBudget.name);
      }
    } catch (err) {
      setYnabError("Connection error");
      console.error("[settings] YNAB connect error:", err);
    } finally {
      setYnabLoading(false);
    }
  };

  const handleYnabDisconnect = async () => {
    setYnabLoading(true);
    console.info("[settings] Disconnecting YNAB");
    try {
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ynab_access_token: null,
          ynab_budget_id: null,
        }),
      });
      if (res.ok) {
        setProfile((prev) => prev ? { ...prev, ynab_connected: false, ynab_budget_id: null } : prev);
        setYnabToken("");
        setYnabBudgetId("");
        console.info("[settings] YNAB disconnected");
      }
    } catch (err) {
      console.error("[settings] YNAB disconnect error:", err);
    } finally {
      setYnabLoading(false);
    }
  };

  const handleBudgetIdSave = async (budgetId?: string) => {
    const id = budgetId || ynabBudgetId;
    if (!id.trim()) return;
    console.info("[settings] Saving budget ID:", id);
    try {
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ynab_budget_id: id.trim() }),
      });
      if (res.ok) {
        setProfile((prev) => prev ? { ...prev, ynab_budget_id: id.trim() } : prev);
        console.info("[settings] Budget ID saved");
      }
    } catch (err) {
      console.error("[settings] Budget ID save error:", err);
    }
  };

  const handleSync = async () => {
    setSyncLoading(true);
    setSyncResult("");
    console.info("[settings] Starting YNAB sync");

    try {
      const res = await fetch("/api/ynab/sync", { method: "POST" });
      const data = await res.json();

      if (data.success) {
        setSyncResult("Sync complete");
        setProfile((prev) => prev ? { ...prev, last_ynab_sync: new Date().toISOString() } : prev);
        console.info("[settings] YNAB sync complete");
      } else {
        setSyncResult(data.error || "Sync failed");
        console.error("[settings] YNAB sync failed:", data.error);
      }
    } catch (err) {
      setSyncResult("Connection error");
      console.error("[settings] YNAB sync error:", err);
    } finally {
      setSyncLoading(false);
      setTimeout(() => setSyncResult(""), 5000);
    }
  };

  if (loading) {
    return (
      <div className="page-loading">
        <Loader2 className="page-loading-spinner animate-spin" />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div>
        <h1 className="page-heading">{t.settings.title}</h1>
        <p className="page-subtitle">{t.settings.subtitle}</p>
      </div>

      <div className="settings-grid">
        {/* Profile */}
        <Card className="settings-card">
          <CardHeader>
            <CardTitle className="settings-card-title">
              <User />
              {t.settings.profile}
            </CardTitle>
          </CardHeader>
          <CardContent className="form-stack">
            <div className="form-field">
              <Label>{locale === "fi" ? "Nimi" : "Name"}</Label>
              <div className="settings-row">
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={locale === "fi" ? "Etunimi" : "First name"}
                  className="settings-input"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await fetch("/api/profile", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ display_name: displayName }),
                    });
                    setNameSaved(true);
                    setTimeout(() => setNameSaved(false), 2000);
                  }}
                >
                  {t.common.save}
                </Button>
                {nameSaved && <span className="settings-saved">{t.common.saved}</span>}
              </div>
              <p className="settings-help">
                {locale === "fi" ? "Näytetään tervehdyksessä ja chatissa" : "Shown in greeting and chat"}
              </p>
            </div>
            <div className="form-field">
              <Label>{locale === "fi" ? "Tilit" : "Accounts"}</Label>
              <p className="settings-help settings-help-mb">
                {locale === "fi"
                  ? "Hallinnoi tilejä, käyttötiliä, päiväbudjetista poissulkemista ja muistiinpanoja Tilit-sivulla."
                  : "Manage accounts, your spending account, daily-budget exclusions and notes on the Accounts page."}
              </p>
              <a href="/accounts" className="settings-link-btn">{locale === "fi" ? "Avaa Tilit" : "Open Accounts"}</a>
            </div>
            <div className="form-field">
              <Label>{locale === "fi" ? "Oma osuus päiväbudjetista (%)" : "Your share of daily budget (%)"}</Label>
              <div className="settings-row">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={personalBudgetShare}
                  onChange={(e) => setPersonalBudgetShare(e.target.value)}
                  placeholder={locale === "fi" ? "0 = automaattinen" : "0 = automatic"}
                  className="settings-input"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    console.info("[settings] Saving personal budget share:", personalBudgetShare);
                    await fetch("/api/profile", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ budget_share: personalBudgetShare || "0" }),
                    });
                    setPersonalShareSaved(true);
                    setTimeout(() => setPersonalShareSaved(false), 2000);
                  }}
                >
                  {t.common.save}
                </Button>
                {personalShareSaved && <span className="settings-saved">{t.common.saved}</span>}
              </div>
              <p className="settings-help">
                {locale === "fi"
                  ? "Kuinka suuri osa päiväbudjetista on sinun henkilökohtainen osuutesi. 0 = lasketaan automaattisesti kulutushistoriasta."
                  : "Your personal portion of the daily budget. 0 = calculated automatically from your spending history."}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Language */}
        <Card className="settings-card">
          <CardHeader>
            <CardTitle className="settings-card-title">
              <Globe />
              {t.settings.language}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="settings-row">
              <Select value={language} onValueChange={(v) => v && handleLanguageChange(v)}>
                <SelectTrigger className="settings-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="fi">Suomi</SelectItem>
                </SelectContent>
              </Select>
              {langSaved && (
                <span className="settings-saved">{t.common.saved}</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Decimal places */}
        <Card className="settings-card">
          <CardHeader>
            <CardTitle className="settings-card-title">
              <Globe />
              {locale === "fi" ? "Desimaalit" : "Decimal places"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="settings-row">
              <Select
                value={decimalPlaces}
                onValueChange={async (v) => {
                  if (!v) return;
                  setDecimalPlaces(v);
                  setDecimals(parseInt(v, 10));
                  console.info("[settings] Saving decimal places:", v);
                  await fetch("/api/household", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ decimal_places: v }),
                  });
                  setDecimalSaved(true);
                  setTimeout(() => setDecimalSaved(false), 2000);
                }}
              >
                <SelectTrigger className="settings-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0 (1234 €)</SelectItem>
                  <SelectItem value="1">1 (1234.5 €)</SelectItem>
                  <SelectItem value="2">2 (1234.56 €)</SelectItem>
                </SelectContent>
              </Select>
              {decimalSaved && <span className="settings-saved">{t.common.saved}</span>}
            </div>
            <p className="settings-help">
              {locale === "fi"
                ? "Kuinka monta desimaalia euroissa. Koskee koko sovellusta."
                : "Number of decimal places for euro amounts. Applies globally."}
            </p>
          </CardContent>
        </Card>

        {/* Household profile */}
        <Card className="settings-card">
          <CardHeader>
            <CardTitle className="settings-card-title">
              <Users />
              {locale === "fi" ? "Talouden tiedot" : "Household details"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="form-field">
              <div className="form-field">
                <Label>{locale === "fi" ? "Talouden koko" : "Household size"}</Label>
                <div className="settings-row">
                  <Input
                    type="number"
                    min="1"
                    max="20"
                    value={householdSize}
                    onChange={(e) => setHouseholdSize(e.target.value)}
                    className="settings-input"
                  />
                </div>
                <p className="settings-help">
                  {locale === "fi" ? "Montako henkilöä taloudessa (vaikuttaa henkilökohtaiseen budjettiin)" : "Number of people (affects personal budget calculation)"}
                </p>
              </div>
              <Label>{locale === "fi" ? "Kuvaus AI-neuvontaa varten" : "Description for AI advisor"}</Label>
              <textarea
                className="settings-textarea"
                value={householdProfile}
                onChange={(e) => setHouseholdProfile(e.target.value)}
                placeholder={locale === "fi"
                  ? "Esim. perhe: 2 aikuista ja 2 lasta. Asumme vuokralla."
                  : "E.g. Family: 2 adults and 2 kids. We rent."}
                rows={3}
              />
              <div className="settings-row">
                <button
                  type="button"
                  className="button"
                  data-variant="outline"
                  data-size="sm"
                  onClick={async () => {
                    console.info("[settings] Saving household profile");
                    await fetch("/api/household", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ household_profile: householdProfile, household_size: householdSize }),
                    });
                    setHouseholdSaved(true);
                    setTimeout(() => setHouseholdSaved(false), 2000);
                  }}
                >
                  {t.common.save}
                </button>
                {householdSaved && <span className="settings-saved">{t.common.saved}</span>}
              </div>
              <p className="settings-help">
                {locale === "fi"
                  ? "AI-neuvoja k\u00e4ytt\u00e4\u00e4 t\u00e4t\u00e4 antaessaan r\u00e4\u00e4t\u00e4l\u00f6ityj\u00e4 neuvoja"
                  : "The AI advisor uses this to give tailored advice"}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Saving rate */}
        <Card className="settings-card">
          <CardHeader>
            <CardTitle className="settings-card-title">
              <PiggyBank />
              {locale === "fi" ? "Säästötavoite" : "Saving goal"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="form-field">
              <Label>{locale === "fi" ? "Kuukausittainen säästötavoite (€)" : "Monthly saving goal (€)"}</Label>
              <div className="settings-row">
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={savingRate}
                  onChange={(e) => setSavingRate(e.target.value)}
                  placeholder="0"
                  className="settings-input"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    console.info("[settings] Saving saving rate:", savingRate);
                    await fetch("/api/household", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ saving_rate: savingRate || "0" }),
                    });
                    setSavingRateSaved(true);
                    setTimeout(() => setSavingRateSaved(false), 2000);
                  }}
                >
                  {t.common.save}
                </Button>
                {savingRateSaved && (
                  <span className="settings-saved">{t.common.saved}</span>
                )}
              </div>
              <p className="settings-help">
                {locale === "fi"
                  ? "Vähennetään käytettävissä olevasta saldosta ennen päiväbudjetin laskemista"
                  : "Deducted from available balance before calculating daily budget"}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Daily budget settings */}
        <Card className="settings-card">
          <CardHeader>
            <CardTitle className="settings-card-title">
              <Wallet />
              {locale === "fi" ? "Päiväbudjetti" : "Daily budget"}
            </CardTitle>
          </CardHeader>
          <CardContent className="form-stack">
            <div className="form-field">
              <p className="settings-help">
                {locale === "fi"
                  ? "Päiväbudjetti lasketaan liukuvalla 14 päivän ikkunalla. Huomioi nykyisen saldon, tulevat tulot ja velvoitteet ikkunan sisällä. Pakolliseksi merkityt laskut ja velat vähennetään aina."
                  : "Daily budget uses a rolling 14-day window. Considers current balance, upcoming income and obligations within the window. Must-pay bills and debts are always subtracted."}
              </p>
            </div>
            <div className="form-field">
              <Label>{locale === "fi" ? "Laskut päiväbudjetissa" : "Bills in daily budget"}</Label>
              <div className="settings-row">
                <select
                  className="input settings-input"
                  value={budgetBillsMode}
                  onChange={async (e) => {
                    setBudgetBillsMode(e.target.value);
                    await fetch("/api/household", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ budget_include_bills: e.target.value }),
                    });
                    setBillsModeSaved(true);
                    setTimeout(() => setBillsModeSaved(false), 2000);
                  }}
                >
                  <option value="auto">{locale === "fi" ? "Automaattinen" : "Automatic"}</option>
                  <option value="1">{locale === "fi" ? "Aina mukana" : "Always included"}</option>
                  <option value="0">{locale === "fi" ? "Ei koskaan" : "Never"}</option>
                </select>
                {billsModeSaved && <span className="settings-saved">{t.common.saved}</span>}
              </div>
              <p className="settings-help">
                {locale === "fi"
                  ? "Automaattinen: laskut mukana jos tili kattaa ne ja budjetti pysyy normaalin yllä. Muuten lasketaan ilman."
                  : "Automatic: bills included if balance covers them and budget stays above normal threshold. Otherwise excluded."}
              </p>
            </div>
            <div className="form-field">
              <Label>{locale === "fi" ? "Varaa seuraavan kuun säästö palkkapäivänä" : "Reserve next month's saving on payday"}</Label>
              <div className="settings-row">
                <Switch
                  checked={reserveNextMonthSaving}
                  onCheckedChange={async (v) => {
                    setReserveNextMonthSaving(v);
                    await fetch("/api/household", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ reserve_next_month_saving: v ? "1" : "0" }),
                    });
                    setReserveSaved(true);
                    setTimeout(() => setReserveSaved(false), 2000);
                  }}
                />
                {reserveSaved && <span className="settings-saved">{t.common.saved}</span>}
              </div>
              <p className="settings-help">
                {locale === "fi"
                  ? "Käytä jos suurin palkka tulee kuun viimeisinä päivinä. Varaa palkkapäivänä koko ensi kuun säästötavoitteen, jolloin päiväbudjetti ei näytä liian runsaalta. Ensi kuussa säästötavoite vähennetään automaattisesti, koska se on jo varattu."
                  : "Use if your largest paycheck arrives in the last days of the month. Reserves next month's full saving goal on payday so the daily budget doesn't look overly generous. Next month skips the proportional saving deduction since it's already reserved."}
              </p>
            </div>
            <div className="form-field">
              <Label>{locale === "fi" ? "YNAB-synkronoinnin tunti" : "YNAB sync hour"}</Label>
              <div className="settings-row">
                <Input
                  type="number"
                  min="0"
                  max="23"
                  value={ynabSyncHour}
                  onChange={(e) => setYnabSyncHour(e.target.value)}
                  className="settings-input"
                />
                <Button size="sm" variant="outline" onClick={async () => {
                  const h = String(Math.min(23, Math.max(0, parseInt(ynabSyncHour, 10) || 6)));
                  setYnabSyncHour(h);
                  await fetch("/api/household", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ynab_sync_hour: h }),
                  });
                  setSyncHourSaved(true);
                  setTimeout(() => setSyncHourSaved(false), 2000);
                }}>{t.common.save}</Button>
                {syncHourSaved && <span className="settings-saved">{t.common.saved}</span>}
              </div>
              <p className="settings-help">
                {locale === "fi"
                  ? "Tunti (0–23, Helsingin aika), jolloin YNAB synkronoidaan automaattisesti kerran päivässä."
                  : "Hour (0–23, Helsinki time) when YNAB is synced automatically once a day."}
              </p>
            </div>
            <div className="form-field">
              <Label>{locale === "fi" ? "Budjettirajat (€)" : "Budget thresholds (€)"}</Label>
              <div className="list-edit-row">
                <div className="list-edit-field">
                  <Label className="list-edit-label">{locale === "fi" ? "Tiukka" : "Tight"}</Label>
                  <Input type="number" value={thresholds.tight} onChange={(e) => setThresholds((p) => ({ ...p, tight: e.target.value }))} className="settings-input" />
                </div>
                <div className="list-edit-field">
                  <Label className="list-edit-label">{locale === "fi" ? "Normaali" : "Normal"}</Label>
                  <Input type="number" value={thresholds.normal} onChange={(e) => setThresholds((p) => ({ ...p, normal: e.target.value }))} className="settings-input" />
                </div>
                <div className="list-edit-field">
                  <Label className="list-edit-label">{locale === "fi" ? "Hyvä" : "Good"}</Label>
                  <Input type="number" value={thresholds.good} onChange={(e) => setThresholds((p) => ({ ...p, good: e.target.value }))} className="settings-input" />
                </div>
                <Button size="sm" variant="outline" onClick={async () => {
                  await fetch("/api/household", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      budget_threshold_tight: thresholds.tight || "20",
                      budget_threshold_normal: thresholds.normal || "30",
                      budget_threshold_good: thresholds.good || "50",
                    }),
                  });
                  setThresholdsSaved(true);
                  setTimeout(() => setThresholdsSaved(false), 2000);
                }}>{t.common.save}</Button>
                {thresholdsSaved && <span className="settings-saved">{t.common.saved}</span>}
              </div>
              <p className="settings-help">
                {locale === "fi"
                  ? "Alle tiukan = varoitus. Tiukka-normaali = maltillisesti. Normaali-hyvä = ok. Yli hyvän = älä tuhlaa, säästä."
                  : "Below tight = warning. Tight-normal = be careful. Normal-good = ok. Above good = don't splurge, save."}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* YNAB Integration */}
        <Card className="settings-card">
          <CardHeader>
            <CardTitle className="settings-card-title">
              <Link />
              {t.settings.ynab}
            </CardTitle>
          </CardHeader>
          <CardContent className="form-stack">
            <div className="settings-row">
              <span className="settings-status">{t.common.status}:</span>
              {profile?.ynab_connected ? (
                <Badge className="badge-connected">
                  <CheckCircle2 />
                  {t.settings.ynabConnected}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <XCircle />
                  {t.settings.ynabDisconnected}
                </Badge>
              )}
            </div>

            {!profile?.ynab_connected ? (
              <div className="form-stack">
                <p className="settings-help">
                  {locale === "fi"
                    ? "Vapaaehtoinen. Ilman YNABia Dough toimii itsenäisesti (käytä Synciä tai lisää tapahtumat käsin). Yhdistä YNAB näin:"
                    : "Optional. Without YNAB, Dough runs on its own (use Synci or add transactions manually). To connect YNAB:"}
                </p>
                <ol className="setup-steps">
                  <li>
                    <span className="setup-step-num">1</span>
                    <span>{locale === "fi" ? "Avaa YNAB: Account Settings → Developer Settings → New Token." : "In YNAB: Account Settings → Developer Settings → New Token."}</span>
                  </li>
                  <li>
                    <span className="setup-step-num">2</span>
                    <span>{locale === "fi" ? "Liitä avain alle ja paina Yhdistä." : "Paste the token below and press Connect."}</span>
                  </li>
                  <li>
                    <span className="setup-step-num">3</span>
                    <span>{locale === "fi" ? "Valitse budjetti listalta." : "Pick your budget from the list."}</span>
                  </li>
                </ol>
                <div className="form-field">
                  <Label>{t.settings.ynabToken}</Label>
                  <Input
                    type="password"
                    placeholder={t.settings.ynabTokenPlaceholder}
                    value={ynabToken}
                    onChange={(e) => setYnabToken(e.target.value)}
                    className="settings-input"
                  />
                  <p className="settings-help">
                    {t.settings.ynabTokenHelp}
                  </p>
                </div>
                {ynabError && <p className="settings-error">{ynabError}</p>}
                <Button size="sm" onClick={handleYnabConnect} disabled={ynabLoading}>
                  {ynabLoading ? t.common.connecting : t.common.connect}
                </Button>
              </div>
            ) : (
              <div className="form-stack">
                <div className="form-field">
                  <Label>{t.settings.budget}</Label>
                  {ynabBudgets.length > 0 ? (
                    <Select
                      value={ynabBudgetId}
                      onValueChange={(v) => {
                        if (v) {
                          setYnabBudgetId(v);
                          handleBudgetIdSave(v);
                        }
                      }}
                    >
                      <SelectTrigger className="settings-input">
                        <SelectValue placeholder={t.settings.selectBudget} />
                      </SelectTrigger>
                      <SelectContent>
                        {ynabBudgets.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="settings-sync-time">{t.common.loading}</span>
                  )}
                </div>
                <div className="settings-row">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSync}
                    disabled={syncLoading}
                  >
                    <RefreshCw className={`sync-icon ${syncLoading ? "animate-spin" : ""}`} />
                    {syncLoading ? t.settings.syncing : t.settings.syncNow}
                  </Button>
                  <span className="settings-sync-time">
                    {syncResult || (profile.last_ynab_sync
                      ? `${t.settings.lastSync}: ${new Date(profile.last_ynab_sync).toLocaleDateString("fi-FI")}`
                      : t.common.neverSynced)}
                  </span>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleYnabDisconnect}
                  disabled={ynabLoading}
                >
                  {ynabLoading ? t.common.disconnecting : t.settings.disconnectYnab}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Synci bank sync */}
        <Card className="settings-card">
          <CardHeader>
            <CardTitle className="settings-card-title">
              <Link />
              Synci
            </CardTitle>
          </CardHeader>
          <CardContent className="form-stack">
            <p className="settings-help">
              {profile?.ynab_connected
                ? (locale === "fi"
                  ? "Synci hakee pankkitulot automaattisesti ja siirtää ne YNAB:iin. Ei tarvitse syöttää tuloja manuaalisesti."
                  : "Synci fetches bank income automatically and syncs it to YNAB. No need to enter income manually.")
                : (locale === "fi"
                  ? "Synci tuo pankkitapahtumat automaattisesti Doughiin. Tilisiirrot tunnistetaan ja kaikki tapahtumat tuodaan, ei vain tulot."
                  : "Synci imports bank transactions automatically into Dough. Transfers are detected and all transactions are imported, not just income.")}
            </p>
            {!synciConnected && (
              <ol className="setup-steps">
                <li>
                  <span className="setup-step-num">1</span>
                  <span>{locale === "fi" ? "Luo tili osoitteessa synci.io ja yhdistä pankkisi." : "Create an account at synci.io and connect your bank."}</span>
                </li>
                <li>
                  <span className="setup-step-num">2</span>
                  <span>{locale === "fi" ? "Synci dashboard: Developers → Tokens, luo API-avain ja liitä se alle." : "In the Synci dashboard: Developers → Tokens, create a token and paste it below."}</span>
                </li>
                <li>
                  <span className="setup-step-num">3</span>
                  <span>{locale === "fi" ? "Yhdistä, ja kartoita pankkitilit Dough-tileihin alla." : "Connect, then map your bank accounts to Dough accounts below."}</span>
                </li>
              </ol>
            )}
            <div className="form-field">
              <Label>{locale === "fi" ? "API-avain" : "API token"}</Label>
              <Input
                type="password"
                placeholder={locale === "fi" ? "Synci API-avain" : "Synci API token"}
                value={synciToken}
                onChange={(e) => { setSynciToken(e.target.value); setSynciSaved(false); }}
                className="settings-input"
              />
              <p className="settings-help">
                {locale === "fi"
                  ? "Synci dashboard: Developers > Tokens"
                  : "Synci dashboard: Developers > Tokens"}
              </p>
              {synciSaved && <p className="settings-success"><CheckCircle2 className="icon-sm" /> {locale === "fi" ? "Yhdistetty" : "Connected"}</p>}
              <div className="settings-row">
                <Button
                  size="sm"
                  disabled={(!synciToken || synciToken.startsWith("••")) && !synciConnected || synciLoading}
                  onClick={async () => {
                    const val = synciToken.startsWith("••") ? undefined : synciToken.trim();
                    if (!val && !synciConnected) return;
                    setSynciLoading(true);
                    try {
                      if (val) {
                        await fetch("/api/household", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ synci_api_token: val }),
                        });
                      }
                      const res = await fetch("/api/synci/accounts");
                      const data = await res.json();
                      if (data.accounts) {
                        setSynciAccounts(data.accounts);
                        setSynciConnected(true);
                        setSynciToken("••••••••");
                        setSynciSaved(true);
                      }
                    } finally {
                      setSynciLoading(false);
                    }
                  }}
                >
                  {synciLoading ? (locale === "fi" ? "Yhdistetään..." : "Connecting...") : synciConnected ? (locale === "fi" ? "Päivitä tilit" : "Refresh accounts") : (locale === "fi" ? "Yhdistä" : "Connect")}
                </Button>
                {synciConnected && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={async () => {
                      await fetch("/api/household", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ synci_api_token: null, synci_accounts: null, synci_account_mapping: null }),
                      });
                      setSynciToken("");
                      setSynciConnected(false);
                      setSynciAccounts([]);
                      setSynciMappings({});
                      setSynciSaved(false);
                    }}
                  >
                    {locale === "fi" ? "Katkaise yhteys" : "Disconnect"}
                  </Button>
                )}
              </div>
            </div>
            {synciAccounts.length > 0 && (
              <div className="form-field">
                <Label>{locale === "fi" ? "Tilien mäppäys" : "Account mapping"}</Label>
                <p className="settings-help">
                  {profile?.ynab_connected
                    ? (locale === "fi"
                      ? "Yhdistä Synci-pankkitilit YNAB-tileihin. Vain yhdistettyjen tilien tulot siirretään."
                      : "Map Synci bank accounts to YNAB accounts. Only mapped accounts sync income.")
                    : (locale === "fi"
                      ? "Yhdistä Synci-pankkitilit Dough-tileihin. Vain yhdistettyjen tilien tapahtumat tuodaan."
                      : "Map Synci bank accounts to your Dough accounts. Only mapped accounts are imported.")}
                </p>
                {synciAccounts.map((acc) => (
                  <div key={acc.id} className="form-field">
                    <Label>{acc.owner} (****{acc.iban.slice(-4)})</Label>
                    <Select
                      value={synciMappings[acc.id] || ""}
                      onValueChange={async (v) => {
                        if (!v) return;
                        const next = { ...synciMappings, [acc.id]: v };
                        setSynciMappings(next);
                        await fetch("/api/household", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ synci_account_mapping: JSON.stringify(next) }),
                        });
                        setSynciMappingSaved(true);
                        setTimeout(() => setSynciMappingSaved(false), 2000);
                      }}
                    >
                      <SelectTrigger className="settings-input">
                        <SelectValue placeholder={profile?.ynab_connected ? (locale === "fi" ? "Valitse YNAB-tili" : "Select YNAB account") : (locale === "fi" ? "Valitse tili" : "Select account")} />
                      </SelectTrigger>
                      <SelectContent>
                        {allAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                {synciMappingSaved && <p className="settings-success"><CheckCircle2 className="icon-sm" /> {locale === "fi" ? "Tallennettu" : "Saved"}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI prompts */}
        <Card className="settings-card">
          <CardHeader>
            <CardTitle className="settings-card-title">
              <Sparkles />
              {locale === "fi" ? "AI-ohjeet" : "AI prompts"}
            </CardTitle>
          </CardHeader>
          <CardContent className="form-stack">
            <div className="form-field">
              <Label>{locale === "fi" ? "Piilota AI-yhteenvedot" : "Hide AI summaries"}</Label>
              <div className="settings-row">
                <Switch
                  checked={aiSummariesDisabled}
                  onCheckedChange={async (v) => {
                    setAiSummariesDisabled(v);
                    await fetch("/api/household", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ ai_summaries_disabled: v ? "1" : "0" }),
                    });
                    setAiSummariesSaved(true);
                    setTimeout(() => setAiSummariesSaved(false), 2000);
                  }}
                />
                {aiSummariesSaved && <span className="settings-saved">{t.common.saved}</span>}
              </div>
              <p className="settings-help">
                {locale === "fi"
                  ? "Piilottaa AI-yhteenvedot ja velkasuosituksen kaikkialta sovelluksessa. Asetus on jaettu kotitalouden kaikille käyttäjille."
                  : "Hides AI summaries and the debt suggestion across the app. Setting is shared with all household users."}
              </p>
            </div>
            {([
              { key: "chat" as const, dbKey: "prompt_chat_guidelines", label: locale === "fi" ? "Keskustelun ohjeet" : "Chat guidelines" },
              { key: "summary" as const, dbKey: "prompt_summary_instructions", label: locale === "fi" ? "Yhteenvedon ohjeet" : "Summary instructions" },
              { key: "debt" as const, dbKey: "prompt_debt_instructions", label: locale === "fi" ? "Velkaneuvonnan ohjeet" : "Debt advice instructions" },
            ]).map(({ key, dbKey, label }) => (
              <div key={key} className="form-field">
                <Label>{label}</Label>
                <textarea
                  className="settings-textarea"
                  value={prompts[key]}
                  onChange={(e) => setPrompts((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder={locale === "fi" ? "Ohjeet tekoälylle" : "Instructions for AI"}
                  rows={4}
                />
                <div className="settings-row">
                  <button
                    type="button"
                    className="button"
                    data-variant="outline"
                    data-size="sm"
                    onClick={async () => {
                      await fetch("/api/household", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ [dbKey]: prompts[key] || "" }),
                      });
                      setPromptSaved(key);
                      setTimeout(() => setPromptSaved(""), 2000);
                    }}
                  >
                    {t.common.save}
                  </button>
                  {promptSaved === key && <span className="settings-saved">{t.common.saved}</span>}
                </div>
              </div>
            ))}
            <p className="settings-help">
              {locale === "fi"
                ? "Muokkaa AI:n toimintaohjeita. Tyhjennä kenttä palauttaaksesi oletusohje."
                : "Edit AI behavior. Clear a field to restore the default prompt."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
