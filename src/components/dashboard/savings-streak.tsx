"use client";

import { useLocale } from "@/lib/locale-context";
import { Card } from "@/components/ui/card";
import { Flame } from "lucide-react";
import { useEffect, useRef } from "react";
import { useDailyHistory } from "@/lib/use-daily-history";
import { streakWeek } from "@/lib/savings-streak";

interface SavingsStreakProps {
  dailyBudget: number;
  todaySpent: number;
  discretionaryTarget?: number;
  /* Real spend per date, which outranks the stored snapshot for any day it covers. */
  spentByDate?: Record<string, number>;
}

export function SavingsStreak({ dailyBudget, todaySpent, discretionaryTarget, spentByDate }: SavingsStreakProps) {
  const { locale, fmt } = useLocale();
  const history = useDailyHistory();
  const savedRef = useRef(false);
  const now = new Date();
  const today = now.getDate();

  // Save today's budget + spending once
  useEffect(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    const d = new Date();
    const todayDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    fetch("/api/daily-budget-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: todayDate, budget: dailyBudget, spent: todaySpent, discretionary_target: discretionaryTarget || 0 }),
    }).catch(() => {});
  }, [dailyBudget, todaySpent, discretionaryTarget]);

  const { days, current: currentStreak } = streakWeek({
    now, history, spentByDate: spentByDate ?? {}, dailyBudget, todaySpent,
  });

  // Bar height is the day's spending against that day's budget, so the row reads as a chart of
  // how close each day ran rather than as a row of pass/fail badges.
  const ratio = (d: { budget: number; spent: number }) => (d.budget > 0 ? d.spent / d.budget : 0);
  const scale = Math.max(1.25, ...days.map(ratio));

  return (
    <Card className="metric-card savings-streak-card">
      <div className="metric-card-row">
        <div className="metric-card-icon" data-color="chart-3">
          <Flame />
        </div>
        <div>
          <p className="metric-card-label">{locale === "fi" ? "Säästöputki" : "Savings streak"}</p>
          <p className="metric-card-value">{currentStreak} {locale === "fi" ? (currentStreak === 1 ? "päivä" : "päivää") : (currentStreak === 1 ? "day" : "days")}</p>
          <div className="streak-bars" aria-hidden="true">
            {days.map((d, i) => {
              const isToday = d.status === "today";
              const over = isToday ? dailyBudget > 0 && d.spent > dailyBudget : d.status === "fail";
              const none = d.status === "nodata";
              return (
                <span
                  key={i}
                  className={`streak-bar ${none ? "is-none" : over ? "is-over" : "is-under"} ${isToday ? "is-today" : ""}`}
                >
                  <span className="streak-bar-fill" style={{ height: `${Math.min(100, (ratio(d) / scale) * 100)}%` }} />
                  <span className="savings-streak-tooltip">
                    <span>{d.day}.{d.month}.</span>
                    <span>{none ? (locale === "fi" ? "ei dataa" : "no data") : `${fmt(isToday ? todaySpent : d.spent)}/${fmt(d.budget)} €`}</span>
                  </span>
                </span>
              );
            })}
            {/* The budget line sits where a bar would reach at exactly 100% of that day's budget. */}
            <span className="streak-bars-limit" style={{ bottom: `${(1 / scale) * 100}%` }} />
          </div>
          <p className="metric-card-note">
            {currentStreak > 0
              ? (locale === "fi" ? `Olet onnistunut selviämään alle päiväbudjetin ${currentStreak} päivää putkeen.` : `You've stayed under budget ${currentStreak} days in a row.`)
              : todaySpent > dailyBudget
              ? (locale === "fi" ? "Päiväbudjetti ylitetty. Huomenna uusi mahdollisuus!" : "Over budget today. Tomorrow is a fresh start!")
              : (locale === "fi" ? "Ei putkea vielä. Pysy budjetissa tänään!" : "No streak yet. Stay under budget today!")}
          </p>
        </div>
      </div>
    </Card>
  );
}
