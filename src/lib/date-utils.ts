import { format, formatDistanceToNow, isToday, isYesterday, parseISO, type Locale as DateFnsLocale } from "date-fns";
import { fi, enUS } from "date-fns/locale";

const localeMap: Record<string, DateFnsLocale> = {
  fi,
  en: enUS,
};

export function relativeDate(dateStr: string, locale: string = "en"): string {
  const date = parseISO(dateStr);
  const loc = localeMap[locale] || enUS;

  if (isToday(date)) {
    return locale === "fi" ? "tänään" : "today";
  }
  if (isYesterday(date)) {
    return locale === "fi" ? "eilen" : "yesterday";
  }

  return formatDistanceToNow(date, { addSuffix: true, locale: loc });
}

// Local calendar date as YYYY-MM-DD, from local date parts. NOT toISOString(), which is UTC and in
// UTC+ zones like Helsinki returns the previous calendar day for local midnight/early hours - that
// off-by-one made a transaction dated today render as "tomorrow". Browser and server (Helsinki) are
// both in the user's zone, so local parts give the correct date.
export function localDateIso(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Heading for a day group in a transaction list: today/yesterday, else weekday + d.M.yyyy.
export function dayHeading(dateStr: string, locale: string = "en"): string {
  const date = parseISO(dateStr);
  const loc = localeMap[locale] || enUS;
  if (isToday(date)) return locale === "fi" ? "Tänään" : "Today";
  if (isYesterday(date)) return locale === "fi" ? "Eilen" : "Yesterday";
  const s = format(date, "EEEE d.M.yyyy", { locale: loc });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatDuration(months: number, locale: string = "en"): string {
  if (months <= 0) return locale === "fi" ? "0 kk" : "0m";
  if (months < 12) return locale === "fi" ? `${months} kk` : `${months}m`;
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  if (remaining === 0) return locale === "fi" ? `${years}v` : `${years}y`;
  return locale === "fi" ? `${years}v ${remaining}kk` : `${years}y ${remaining}m`;
}

export function formatDateShort(dateStr: string): string {
  const d = parseISO(dateStr);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

// Recurring "day of month" handling. A stored day is 1-31, or 0 meaning "last day of month".
// These helpers resolve such a day to a real, month-aware calendar date so nothing ever renders an
// impossible date like 31.6 (June has 30 days): day 31 -> 30.6, day 0 -> the month's last day.

// Resolve a day-of-month to a valid day number within a specific month, clamped to its length.
// Day 0 (or any day past the month's end) becomes the last day of that month.
export function resolveDayInMonth(dayOfMonth: number, year: number, monthIndex: number): number {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > lastDay) return lastDay;
  return dayOfMonth;
}

// Clamp a recurring day-of-month to a valid day number within `from`'s month (0/overflow -> last day).
export function resolveDayThisMonth(dayOfMonth: number, from: Date = new Date()): number {
  return resolveDayInMonth(dayOfMonth, from.getFullYear(), from.getMonth());
}

// The concrete date a recurring day falls on within `from`'s own month (clamped, month-aware).
export function dateForDayInMonth(dayOfMonth: number, from: Date = new Date()): Date {
  return new Date(from.getFullYear(), from.getMonth(), resolveDayInMonth(dayOfMonth, from.getFullYear(), from.getMonth()));
}

// The next calendar date a recurring day falls on, on or after `from`. Uses this month if the
// (clamped) day has not passed yet, otherwise rolls to next month. Day 0 = last day of month.
export function nextOccurrence(dayOfMonth: number, from: Date = new Date()): Date {
  const y = from.getFullYear();
  const m = from.getMonth();
  const dThis = resolveDayInMonth(dayOfMonth, y, m);
  if (dThis >= from.getDate()) return new Date(y, m, dThis);
  return new Date(y, m + 1, resolveDayInMonth(dayOfMonth, y, m + 1));
}

// Format a Date as Finnish-style d.M.yyyy (no leading zeros).
export function formatDate(date: Date): string {
  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
}

// Compact d.M. (no year) for tight UI labels.
export function formatDayShort(date: Date): string {
  return `${date.getDate()}.${date.getMonth() + 1}.`;
}
