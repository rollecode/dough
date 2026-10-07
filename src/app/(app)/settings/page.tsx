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
import { RefreshCw, CheckCircle2, XCircle, Globe, Link, Loader2, PiggyBank, Users, Sparkles, User, Wallet, Store } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";
import { F } from "@/components/ui/f";
import { DEFAULT_CHAT_GUIDELINES, DEFAULT_SUMMARY_INSTRUCTIONS, DEFAULT_DEBT_INSTRUCTIONS } from "@/lib/ai/default-prompts";
import { ApiKeysCard } from "@/components/settings/api-keys";
import { McpConnectCard } from "@/components/settings/mcp-connect";
import { YourDataCard } from "@/components/settings/your-data";
import { AiStatusCard } from "@/components/settings/ai-status";
import { PayeesDialog } from "@/components/shared/payees-dialog";

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
  const [ynabOAuth, setYnabOAuth] = useState(false);
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
  const [burnExcluded, setBurnExcluded] = useState<string[]>([]);
  const [burnExcludedSaved, setBurnExcludedSaved] = useState(false);
  const [burnPayee, setBurnPayee] = useState("");
  const [payeesOpen, setPayeesOpen] = useState(false);
  const [payeeNames, setPayeeNames] = useState<string[]>([]);
  const [reserveSaved, setReserveSaved] = useState(false);
  const [goodMonthSaving, setGoodMonthSaving] = useState(false);
  const [goodMonthSaved, setGoodMonthSaved] = useState(false);
  const [goodMonthLevel, setGoodMonthLevel] = useState("50");
  const [dailyCapEnabled, setDailyCapEnabled] = useState(false);
  const [dailyCap, setDailyCap] = useState("");
  const [dailyCapSaved, setDailyCapSaved] = useState(false);
  const [ynabSyncHour, setYnabSyncHour] = useState("6");
  const [syncHourSaved, setSyncHourSaved] = useState(false);
  const [aiSummariesDisabled, setAiSummariesDisabled] = useState(false);
  const [aiSummariesSaved, setAiSummariesSaved] = useState(false);
  const [billsModeSaved, setBillsModeSaved] = useState(false);
  const [thresholds, setThresholds] = useState({ tight: "20", normal: "30", good: "50" });
  const [thresholdsSaved, setThresholdsSaved] = useState(false);
  const [aiModels, setAiModels] = useState({ categorize: "gemini-3-flash-preview", chat: "opus", vision: "gemini-3-flash-preview", insight: "gemini-3-flash-preview" });
  const [geminiKey, setGeminiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [keysSet, setKeysSet] = useState({ gemini: false, anthropic: false });
  const [aiModelsSaved, setAiModelsSaved] = useState(false);
  const [accountsSaved, setAccountsSaved] = useState(false);
  const [accountNotes, setAccountNotes] = useState<Record<string, string>>({});
  const [notesSaved, setNotesSaved] = useState(false);
  const [personalBudgetShare, setPersonalBudgetShare] = useState("");
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferSaved, setTransferSaved] = useState(false);
  const saveTransferDefaults = async (from: string, to: string) => {
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ default_transfer_from: from, default_transfer_to: to }),
    });
    setTransferSaved(true);
    setTimeout(() => setTransferSaved(false), 2000);
  };
  const [personalShareSaved, setPersonalShareSaved] = useState(false);
  const [decimalPlaces, setDecimalPlaces] = useState("0");
  const [decimalSaved, setDecimalSaved] = useState(false);
  const [dateFormatVal, setDateFormatVal] = useState("d.m.yyyy");
  const [timeFormatVal, setTimeFormatVal] = useState("24h");
  const [dtSaved, setDtSaved] = useState(false);
  const [synciToken, setSynciToken] = useState("");
  const [synciSaved, setSynciSaved] = useState(false);
  const [synciConnected, setSynciConnected] = useState(false);
  const [synciAccounts, setSynciAccounts] = useState<{ id: string; iban: string; owner: string; currency?: string; name?: string; customName?: string }[]>([]);
  const [synciMappings, setSynciMappings] = useState<Record<string, string>>({});
  const [synciMappingSaved, setSynciMappingSaved] = useState(false);
  const [synciLoading, setSynciLoading] = useState(false);
  const [synciTesting, setSynciTesting] = useState(false);
  const [synciTest, setSynciTest] = useState("");
  const [synciTestOk, setSynciTestOk] = useState(false);
  const { t, locale, setLocale, setDecimals, setDateFormat, setTimeFormat, fmtDate } = useLocale();

  // Today's budget beside what was really spent per day last month, from the dashboard model.
  const [spendPace, setSpendPace] = useState<{ budget: number; average: number } | null>(null);
  useEffect(() => {
    fetch("/api/dashboard-model")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.daily_budget) setSpendPace({ budget: d.daily_budget.amount, average: d.daily_budget.average_spent_last_month });
      })
      .catch((err) => console.warn("[settings] Could not load the spending pace:", err));
  }, []);

  useEffect(() => {
    fetch("/api/payees").then((r) => r.json()).then((d) => { if (Array.isArray(d.payees)) setPayeeNames(d.payees); }).catch(() => {});
  }, []);

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
          if (householdData.settings?.date_format) setDateFormatVal(String(householdData.settings.date_format));
          if (householdData.settings?.time_format) setTimeFormatVal(String(householdData.settings.time_format));
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
          if (householdData.settings?.burn_rate_excluded_payees) {
            try { setBurnExcluded(JSON.parse(householdData.settings.burn_rate_excluded_payees) as string[]); } catch {}
          }
          setGoodMonthSaving(householdData.settings?.good_month_saving === "1");
          setGoodMonthLevel(householdData.settings?.good_month_level || "50");
          setDailyCapEnabled(householdData.settings?.daily_cap_enabled === "1");
          setDailyCap(householdData.settings?.daily_cap || "");
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
          if (householdData.settings?.ai_model_categorize) setAiModels((p) => ({ ...p, categorize: householdData.settings.ai_model_categorize }));
          if (householdData.settings?.ai_model_chat) setAiModels((p) => ({ ...p, chat: householdData.settings.ai_model_chat }));
          if (householdData.settings?.ai_model_vision) setAiModels((p) => ({ ...p, vision: householdData.settings.ai_model_vision }));
          if (householdData.settings?.ai_model_insight) setAiModels((p) => ({ ...p, insight: householdData.settings.ai_model_insight }));
          setKeysSet({ gemini: !!householdData.settings?.gemini_key_set, anthropic: !!householdData.settings?.anthropic_key_set });
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
            setTransferFrom(profileData.profile.default_transfer_from || "");
            setTransferTo(profileData.profile.default_transfer_to || "");
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
          setYnabOAuth(!!householdData.settings?.ynab_oauth_available);
          // Back from signing in to YNAB: pick the first budget, as pasting a token does.
          const back = new URLSearchParams(window.location.search).get("ynab");
          if (back) {
            window.history.replaceState({}, "", "/settings");
            if (back === "failed") setYnabError(locale === "fi" ? "YNAB-kirjautuminen epäonnistui" : "Signing in to YNAB failed");
            else if (!householdData.settings?.ynab_budget_id) {
              fetch("/api/ynab/budgets").then((r) => r.json()).then(async (bd) => {
                const first = bd.budgets?.[0];
                if (!first) return;
                setYnabBudgets(bd.budgets);
                setYnabBudgetId(first.id);
                await fetch("/api/household", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ynab_budget_id: first.id }) });
                setProfile((prev) => prev ? { ...prev, ynab_budget_id: first.id } : prev);
              }).catch(() => {});
            }
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
          ynab_refresh_token: null,
          ynab_token_expires_at: null,
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
              <Label>{locale === "fi" ? "Oletussiirto" : "Default transfer"}</Label>
              <div className="settings-row">
                <select
                  className="input settings-input"
                  value={transferFrom}
                  aria-label={locale === "fi" ? "Miltä tililtä" : "From account"}
                  onChange={(e) => { setTransferFrom(e.target.value); saveTransferDefaults(e.target.value, transferTo); }}
                >
                  <option value="">{locale === "fi" ? "Miltä tililtä" : "From account"}</option>
                  {allAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <select
                  className="input settings-input"
                  value={transferTo}
                  aria-label={locale === "fi" ? "Mille tilille" : "To account"}
                  onChange={(e) => { setTransferTo(e.target.value); saveTransferDefaults(transferFrom, e.target.value); }}
                >
                  <option value="">{locale === "fi" ? "Mille tilille" : "To account"}</option>
                  {allAccounts.filter((a) => a.id !== transferFrom).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {transferSaved && <span className="settings-saved">{t.common.saved}</span>}
              </div>
              <p className="settings-help">
                {locale === "fi"
                  ? "Tilit, jotka valitaan valmiiksi, kun lisäät siirron. Vain sinulle."
                  : "The accounts picked for you when you add a transfer. Yours only."}
              </p>
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

        {/* Date and time format */}
        <Card className="settings-card">
          <CardHeader>
            <CardTitle className="settings-card-title">
              <Globe />
              {locale === "fi" ? "Päivä- ja aikamuoto" : "Date and time format"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="settings-row">
              <Select
                value={dateFormatVal}
                onValueChange={async (v) => {
                  if (!v) return;
                  setDateFormatVal(v);
                  setDateFormat(v);
                  console.info("[settings] Saving date format:", v);
                  await fetch("/api/household", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ date_format: v }),
                  });
                  setDtSaved(true);
                  setTimeout(() => setDtSaved(false), 2000);
                }}
              >
                <SelectTrigger className="settings-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="d.m.yyyy">5.6.2026</SelectItem>
                  <SelectItem value="dd.mm.yyyy">05.06.2026</SelectItem>
                  <SelectItem value="yyyy-mm-dd">2026-06-05</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={timeFormatVal}
                onValueChange={async (v) => {
                  if (!v) return;
                  setTimeFormatVal(v);
                  setTimeFormat(v);
                  console.info("[settings] Saving time format:", v);
                  await fetch("/api/household", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ time_format: v }),
                  });
                  setDtSaved(true);
                  setTimeout(() => setDtSaved(false), 2000);
                }}
              >
                <SelectTrigger className="settings-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">{locale === "fi" ? "24 tuntia (14:30)" : "24-hour (14:30)"}</SelectItem>
                  <SelectItem value="12h">{locale === "fi" ? "12 tuntia (2:30 PM)" : "12-hour (2:30 PM)"}</SelectItem>
                </SelectContent>
              </Select>
              {dtSaved && <span className="settings-saved">{t.common.saved}</span>}
            </div>
            <p className="settings-help">
              {locale === "fi"
                ? "Päivämäärien ja aikojen näyttömuoto. Myös päivämääräkentät noudattavat tätä muotoa."
                : "How dates and times are displayed. Date input fields follow this format too."}
            </p>
          </CardContent>
        </Card>

        <AiStatusCard />

        {/* AI models */}
        <Card className="settings-card">
          <CardHeader>
            <CardTitle className="settings-card-title">
              <Globe />
              {locale === "fi" ? "Tekoälymallit" : "AI models"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="settings-model-grid">
              {([
                ["categorize", locale === "fi" ? "Kategorisointi" : "Categorizing"],
                ["chat", locale === "fi" ? "Dougie-keskustelu" : "Dougie chat"],
                ["vision", locale === "fi" ? "Kuitit (kuvat)" : "Receipts (images)"],
                ["insight", locale === "fi" ? "Yhteenvedot ja neuvot" : "Summaries and advice"],
              ] as const).map(([key, label]) => (
                <div className="form-field" key={key}>
                  <Label>{label}</Label>
                  <Select
                    value={aiModels[key]}
                    onValueChange={async (v) => {
                      if (!v) return;
                      const next = { ...aiModels, [key]: v };
                      setAiModels(next);
                      await fetch("/api/household", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ [`ai_model_${key}`]: v }),
                      });
                      setAiModelsSaved(true);
                      setTimeout(() => setAiModelsSaved(false), 2000);
                    }}
                  >
                    <SelectTrigger className="settings-input"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {key !== "chat" && <SelectItem value="gemini-3-flash-preview">Gemini 3 Flash ({locale === "fi" ? "nopea, edullinen" : "fast, low cost"})</SelectItem>}
                      <SelectItem value="haiku">Haiku</SelectItem>
                      <SelectItem value="sonnet">Sonnet</SelectItem>
                      <SelectItem value="opus">Opus ({locale === "fi" ? "tarkin" : "most capable"})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {aiModelsSaved && <span className="settings-saved">{t.common.saved}</span>}
            </div>
            {([
              ["gemini", "gemini_api_key", geminiKey, setGeminiKey, locale === "fi" ? "Gemini API-avain (valinnainen)" : "Gemini API key (optional)", locale === "fi" ? "Tarvitaan vain Gemini-malleille" : "Only needed for Gemini models"],
              ["anthropic", "anthropic_api_key", anthropicKey, setAnthropicKey, locale === "fi" ? "Anthropic API-avain (valinnainen)" : "Anthropic API key (optional)", locale === "fi" ? "Clauden kutsut omalla avaimellasi" : "Claude calls on your own key"],
            ] as const).map(([id, setting, value, setValue, label, hint]) => (
              <div className="form-field" key={id}>
                <Label htmlFor={`ai-key-${id}`}>{label}</Label>
                <Input
                  id={`ai-key-${id}`}
                  type="password"
                  value={value}
                  placeholder={keysSet[id] ? (locale === "fi" ? "Tallennettu, kirjoita korvataksesi" : "Saved, type to replace") : hint}
                  onChange={(e) => setValue(e.target.value)}
                  onBlur={async () => {
                    // Saved only when something was typed; an empty field never clears a saved key.
                    if (!value.trim()) return;
                    await fetch("/api/household", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ [setting]: value.trim() }),
                    });
                    setValue("");
                    setKeysSet((k) => ({ ...k, [id]: true }));
                    setAiModelsSaved(true);
                    setTimeout(() => setAiModelsSaved(false), 2000);
                  }}
                />
              </div>
            ))}
            <p className="settings-help">
              {locale === "fi"
                ? "Dougie käyttää Claudea CLI:n kautta. Kaikki muu (kategorisointi, kuitit, yhteenvedot ja neuvot) toimii Gemini 3 Flashilla, kun Gemini-avain on tallennettu. Ilman avainta nekin käyttävät Claudea. Anthropic-avaimella Claude käyttää sitä."
                : "Dougie runs on Claude through the CLI. Everything else (categorizing, receipts, summaries and advice) runs on Gemini 3 Flash once a Gemini key is saved; without one, those use Claude too. With an Anthropic key, Claude runs on that key instead."}
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
                  ? "Päiväbudjetti jakaa nykyisen saldon 14 päivälle, tai palkkapäivään asti ja yhden varapäivän päälle, jos palkka tulee aiemmin. Tulevia tuloja ei lasketa etukäteen. Pakolliseksi merkityt laskut ja velat vähennetään aina."
                  : "Daily budget spreads your current balance over 14 days, or until payday plus one spare day when the salary comes sooner. Future income is not counted in advance. Must-pay bills and debts are always subtracted."}
              </p>
            </div>
            {spendPace && (
              <div className="settings-pace">
                <div className="settings-pace-item">
                  <span className="settings-pace-value"><F v={spendPace.budget} s={locale === "fi" ? " €/pv" : " €/day"} /></span>
                  <span className="settings-pace-label">{locale === "fi" ? "Päiväbudjetti nyt" : "Daily budget now"}</span>
                </div>
                <div className="settings-pace-item">
                  <span className="settings-pace-value"><F v={spendPace.average} s={locale === "fi" ? " €/pv" : " €/day"} /></span>
                  <span className="settings-pace-label">{locale === "fi" ? "Käytetty päivässä viime kuussa" : "Spent per day last month"}</span>
                </div>
              </div>
            )}
            <div className="form-field">
              <Label>{locale === "fi" ? "Maksunsaajat, joita kulutusvauhti ei laske" : "Payees left out of the burn rate"}</Label>
              <BurnPayeePicker
                selected={burnExcluded}
                payees={payeeNames}
                query={burnPayee}
                onQuery={setBurnPayee}
                saved={burnExcludedSaved}
                savedLabel={t.common.saved}
                locale={locale}
                onChange={async (names) => {
                  setBurnExcluded(names);
                  await fetch("/api/household", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ burn_rate_excluded_payees: JSON.stringify(names) }),
                  });
                  setBurnExcludedSaved(true);
                  setTimeout(() => setBurnExcludedSaved(false), 2000);
                }}
              />
              <p className="settings-help">
                {locale === "fi"
                  ? "Kulutusvauhti on viimeisen 30 päivän kulutus päivää kohti. Esimerkiksi vuokra jätetään pois, jotta luku kertoo arjen kulutuksesta."
                  : "The burn rate is the last 30 days' spending per day. Leave out rent, for example, so the figure shows everyday spending."}
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
              <Label>{locale === "fi" ? "Säästä hyvinä kuukausina" : "Save in good months"}</Label>
              <div className="settings-row">
                <Switch
                  checked={goodMonthSaving}
                  onCheckedChange={async (v) => {
                    setGoodMonthSaving(v);
                    await fetch("/api/household", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ good_month_saving: v ? "1" : "0" }),
                    });
                    setGoodMonthSaved(true);
                    setTimeout(() => setGoodMonthSaved(false), 2000);
                  }}
                />
                <Input type="number" step="1" min="0" value={goodMonthLevel} onChange={(e) => setGoodMonthLevel(e.target.value)} className="settings-input" disabled={!goodMonthSaving} />
                <Button size="sm" variant="outline" disabled={!goodMonthSaving} onClick={async () => {
                    await fetch("/api/household", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ good_month_level: goodMonthLevel || "0" }),
                    });
                    setGoodMonthSaved(true);
                    setTimeout(() => setGoodMonthSaved(false), 2000);
                  }}>
                  {t.common.save}
                </Button>
                {goodMonthSaved && <span className="settings-saved">{t.common.saved}</span>}
              </div>
              <p className="settings-help">
                {locale === "fi"
                  ? `Kun päiväbudjetti nousisi yli ${goodMonthLevel || 0} € päivässä, siitä näytetään vain puolet ylimenevästä osasta. Loput jää tilille kuukauden säästöksi. Tiukkoina aikoina säästöä käytetään vain sen verran, että budjetti pysyy tällä tasolla.`
                  : `When the daily budget would rise above ${goodMonthLevel || 0} € a day, only half of the extra is shown. The rest stays in the account as the month's saving. In a tight stretch it is used only to keep the budget at this level.`}
              </p>
            </div>
            <div className="form-field">
              <Label>{locale === "fi" ? "Päiväbudjetin yläraja" : "Daily budget cap"}</Label>
              <div className="settings-row">
                <Switch
                  checked={dailyCapEnabled}
                  onCheckedChange={async (v) => {
                    setDailyCapEnabled(v);
                    await fetch("/api/household", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ daily_cap_enabled: v ? "1" : "0" }),
                    });
                    setDailyCapSaved(true);
                    setTimeout(() => setDailyCapSaved(false), 2000);
                  }}
                />
                <Input type="number" step="1" min="0" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} placeholder="0" className="settings-input" disabled={!dailyCapEnabled} />
                <Button size="sm" variant="outline" disabled={!dailyCapEnabled} onClick={async () => {
                    await fetch("/api/household", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ daily_cap: dailyCap || "0" }),
                    });
                    setDailyCapSaved(true);
                    setTimeout(() => setDailyCapSaved(false), 2000);
                  }}>
                  {t.common.save}
                </Button>
                {dailyCapSaved && <span className="settings-saved">{t.common.saved}</span>}
              </div>
              <p className="settings-help">
                {locale === "fi"
                  ? "Päiväbudjetti ei koskaan näytä tätä enempää. Ylimenevä osa jää tilille kuukauden säästöksi."
                  : "The daily budget never shows more than this. The rest stays in the account as the month's saving."}
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
                {ynabOAuth && (
                  <>
                    <a className="button" data-size="sm" href="/api/ynab/oauth/start">
                      {locale === "fi" ? "Kirjaudu YNABiin" : "Sign in with YNAB"}
                    </a>
                    <p className="settings-help">{locale === "fi" ? "Tai liitä oma avain:" : "Or paste a token of your own:"}</p>
                  </>
                )}
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
                      ? `${t.settings.lastSync}: ${fmtDate(profile.last_ynab_sync)}`
                      : t.common.neverSynced)}
                  </span>
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
                      ? "Tunti (0–23, Helsingin aika), jolloin YNAB synkronoidaan automaattisesti kerran päivässä. Synkronoi nyt -painike hakee muutokset milloin tahansa."
                      : "Hour (0–23, Helsinki time) when YNAB is synced automatically once a day. Sync now fetches changes any time."}
                  </p>
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

        {/* Payees: rename and merge, the same dialog the transactions page opens */}
        <Card className="settings-card">
          <CardHeader>
            <CardTitle className="settings-card-title">
              <Store />
              {locale === "fi" ? "Maksunsaajat" : "Payees"}
            </CardTitle>
          </CardHeader>
          <CardContent className="form-stack">
            <p className="settings-help">
              {locale === "fi"
                ? "Nimeä maksunsaaja uudelleen tai yhdistä saman kaupan eri kirjoitusasut yhdeksi. Dough ehdottaa yhdistettäviä."
                : "Rename a payee, or merge the different spellings of one merchant into one. Dough suggests which to merge."}
            </p>
            <div>
              <Button variant="outline" onClick={() => setPayeesOpen(true)}>
                {locale === "fi" ? "Yhdistä maksunsaajia" : "Merge payees"}
              </Button>
            </div>
            <PayeesDialog open={payeesOpen} onOpenChange={setPayeesOpen} />
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
                    variant="outline"
                    size="sm"
                    disabled={synciTesting}
                    onClick={async () => {
                      setSynciTesting(true);
                      setSynciTest("");
                      try {
                        const res = await fetch("/api/synci/accounts");
                        const data = await res.json();
                        if (res.ok && Array.isArray(data.accounts)) {
                          setSynciTestOk(true);
                          setSynciTest(locale === "fi" ? `Yhteys toimii. ${data.accounts.length} tiliä löytyi.` : `Connection works. Found ${data.accounts.length} accounts.`);
                        } else {
                          setSynciTestOk(false);
                          setSynciTest(locale === "fi" ? "Yhteys ei toimi. Tarkista API-avain." : "Connection failed. Check the API token.");
                        }
                      } catch {
                        setSynciTestOk(false);
                        setSynciTest(locale === "fi" ? "Yhteys ei toimi. Tarkista API-avain." : "Connection failed. Check the API token.");
                      } finally {
                        setSynciTesting(false);
                      }
                    }}
                  >
                    {synciTesting ? (locale === "fi" ? "Testataan..." : "Testing...") : (locale === "fi" ? "Testaa yhteys" : "Test connection")}
                  </Button>
                )}
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
              {synciTest && <p className={`synci-test-result ${synciTestOk ? "is-ok" : "is-error"}`}>{synciTest}</p>}
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
                    <Label>{[acc.owner, acc.name, acc.customName].filter(Boolean).join(" · ")}{acc.iban ? ` · ****${acc.iban.slice(-4)}` : ""}</Label>
                    <Select
                      items={Object.fromEntries(allAccounts.map((a) => [a.id, a.name]))}
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

        <McpConnectCard />

        <ApiKeysCard />

        <YourDataCard />
      </div>
    </div>
  );
}


// The payees the burn rate leaves out, picked as in the add dialog: the usual ones as chips, a
// search over every payee, and whatever is typed when none match.
function BurnPayeePicker({ selected, payees, query, onQuery, onChange, saved, savedLabel, locale }: {
  selected: string[]; payees: string[]; query: string; onQuery: (q: string) => void;
  onChange: (names: string[]) => void; saved: boolean; savedLabel: string; locale: string;
}) {
  const has = (name: string) => selected.some((s) => s.toLowerCase() === name.toLowerCase());
  const trimmed = query.trim();
  const remaining = payees.filter((p) => !has(p));
  const matches = trimmed ? remaining.filter((p) => p.toLowerCase().includes(trimmed.toLowerCase())) : remaining;
  const suggestions = matches.slice(0, 8);
  const offerOwn = trimmed && !matches.some((p) => p.toLowerCase() === trimmed.toLowerCase());
  const add = (name: string) => { if (!has(name)) onChange([...selected, name]); onQuery(""); };
  return (
    <div className="burn-picker">
      {selected.length > 0 && (
        <div className="burn-picker-chips">
          {selected.map((name) => (
            <button key={name} type="button" className="match-pattern-tag burn-picker-chip" onClick={() => onChange(selected.filter((s) => s !== name))} aria-label={`${locale === "fi" ? "Poista" : "Remove"} ${name}`}>
              {name} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      <div className="settings-row">
        <Input
          className="settings-input"
          value={query}
          placeholder={locale === "fi" ? "Hae maksunsaajaa" : "Search payees"}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && trimmed) { e.preventDefault(); add(trimmed); } }}
        />
        {saved && <span className="settings-saved">{savedLabel}</span>}
      </div>
      <div className="burn-picker-suggestions">
        {suggestions.map((name) => (
          <button key={name} type="button" className="burn-picker-suggestion" onClick={() => add(name)}>{name}</button>
        ))}
        {offerOwn && <button type="button" className="burn-picker-suggestion" onClick={() => add(trimmed)}>+ {trimmed}</button>}
      </div>
    </div>
  );
}
