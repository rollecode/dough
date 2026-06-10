"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { en } from "./i18n/en";
import { fi } from "./i18n/fi";
import type { Locale } from "./i18n";
import { AppLoading } from "@/components/layout/app-loading";

type TranslationObj = typeof en;

const translations: Record<Locale, TranslationObj> = {
  en,
  fi: fi as unknown as TranslationObj,
};

const pad = (n: number) => String(n).padStart(2, "0");

function formatDateWith(input: string | Date, fmt: string): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (!d || isNaN(d.getTime())) return typeof input === "string" ? input : "";
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  switch (fmt) {
    case "dd.mm.yyyy": return `${pad(day)}.${pad(month)}.${year}`;
    case "yyyy-mm-dd": return `${year}-${pad(month)}-${pad(day)}`;
    default: return `${day}.${month}.${year}`; // d.m.yyyy
  }
}

function formatTimeWith(input: string | Date, fmt: string): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (!d || isNaN(d.getTime())) return "";
  if (fmt === "12h") {
    let h = d.getHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${pad(d.getMinutes())} ${ampm}`;
  }
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslationObj;
  decimals: number;
  setDecimals: (d: number) => void;
  fmt: (n: number) => string;
  mask: (s: string | number) => string;
  privacyMode: boolean;
  setPrivacyMode: (v: boolean) => void;
  dateFormat: string;
  setDateFormat: (f: string) => void;
  timeFormat: string;
  setTimeFormat: (f: string) => void;
  fmtDate: (input: string | Date) => string;
  fmtTime: (input: string | Date) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => {},
  t: en,
  decimals: 0,
  setDecimals: () => {},
  fmt: (n: number) => n.toFixed(0),
  mask: (s: string | number) => String(s),
  privacyMode: false,
  setPrivacyMode: () => {},
  dateFormat: "d.m.yyyy",
  setDateFormat: () => {},
  timeFormat: "24h",
  setTimeFormat: () => {},
  fmtDate: (input: string | Date) => formatDateWith(input, "d.m.yyyy"),
  fmtTime: (input: string | Date) => formatTimeWith(input, "24h"),
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [decimals, setDecimalsState] = useState(0);
  const [privacyMode, setPrivacyModeState] = useState(false);
  const [dateFormat, setDateFormatState] = useState("d.m.yyyy");
  const [timeFormat, setTimeFormatState] = useState("24h");
  // Gate render until the locale is known so the UI never flashes default English first.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    console.debug("[locale] Fetching user locale and settings");
    Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch("/api/household").then((r) => r.json()),
    ]).then(([userData, householdData]) => {
      if (userData.user?.locale) {
        console.info("[locale] User locale:", userData.user.locale);
        setLocaleState(userData.user.locale as Locale);
      }
      const s = householdData.settings;
      if (s?.decimal_places !== undefined) {
        const d = parseInt(s.decimal_places, 10);
        if (d >= 0 && d <= 2) {
          console.info("[locale] Decimal places:", d);
          setDecimalsState(d);
        }
      }
      if (s?.date_format) setDateFormatState(String(s.date_format));
      if (s?.time_format) setTimeFormatState(String(s.time_format));
    }).catch((err) => console.error("[locale] Failed to load settings:", err))
      .finally(() => setReady(true));
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    console.info("[locale] Switching to", newLocale);
    setLocaleState(newLocale);
  }, []);

  const setDecimals = useCallback((d: number) => {
    console.info("[locale] Setting decimals to", d);
    setDecimalsState(d);
  }, []);

  const setDateFormat = useCallback((f: string) => setDateFormatState(f), []);
  const setTimeFormat = useCallback((f: string) => setTimeFormatState(f), []);

  const setPrivacyMode = useCallback((v: boolean) => setPrivacyModeState(v), []);

  const fmt = useCallback((n: number) => {
    let formatted = n.toFixed(decimals);
    // Normalise negative zero ("-0", "-0.00") so it never shows as a minus
    if (/^-0(\.0+)?$/.test(formatted)) formatted = formatted.slice(1);
    if (!privacyMode) return formatted;
    return formatted.replace(/\d/g, "•");
  }, [decimals, privacyMode]);

  // Mask any string/number: replace digits with bullets in privacy mode
  const mask = useCallback((s: string | number) => {
    const str = String(s);
    if (!privacyMode) return str;
    return str.replace(/\d/g, "•");
  }, [privacyMode]);

  const fmtDate = useCallback((input: string | Date) => formatDateWith(input, dateFormat), [dateFormat]);
  const fmtTime = useCallback((input: string | Date) => formatTimeWith(input, timeFormat), [timeFormat]);

  const t = translations[locale] || translations.en;

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t, decimals, setDecimals, fmt, mask, privacyMode, setPrivacyMode, dateFormat, setDateFormat, timeFormat, setTimeFormat, fmtDate, fmtTime }}>
      {ready ? children : <AppLoading />}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
