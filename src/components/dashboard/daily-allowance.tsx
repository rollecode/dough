"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ArrowDown, ArrowUp, CalendarClock, Wallet, Info } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { F } from "@/components/ui/f";
import { SavingsStreak } from "./savings-streak";

interface DailyAllowanceProps {
  dailyBudget: number;
  tomorrowBudget?: number;
  budgetNotice?: { obligationName: string; obligationAmount: number; savingReserve: number; href: string; linkTo: "debt" | "bill" | "saving" } | null;
  availableBalance: number;
  upcomingBills: number;
  nextIncomeAmount: number;
  nextIncomeDate: string;
  daysUntilIncome: number;
  burnRate?: number;
  projectedMonthEnd?: number;
  accountCount?: number;
  billCount?: number;
  todaySpentAll?: number;
  todayRemaining?: number;
  monthIncome?: number;
  monthExpenses?: number;
  trendPercent?: number;
  billsDelayNeeded?: boolean;
  budgetWithBills?: number;
  upcomingObligations?: { name: string; amount: number; dueDay: number; absDay: number }[];
  streakProps?: {
    dailyBudget: number;
    todaySpent: number;
    discretionaryTarget?: number;
  };
  thresholds?: { tight: number; normal: number; good: number };
  budgetBreakdown?: {
    startDay: number;
    endDay: number;
    days: number;
    balanceAtStart: number;
    incomeAtStart: number;
    obligations: number;
    savingGoalDeducted: number;
    pool: number;
  } | null;
  currency?: string;
}

export function DailyAllowance({
  dailyBudget,
  tomorrowBudget = 0,
  budgetNotice = null,
  availableBalance,
  upcomingBills,
  nextIncomeAmount,
  nextIncomeDate,
  daysUntilIncome,
  burnRate = 0,
  projectedMonthEnd = 0,
  accountCount = 0,
  billCount = 0,
  todaySpentAll = 0,
  todayRemaining = 0,
  monthIncome = 0,
  monthExpenses = 0,
  trendPercent = 0,
  billsDelayNeeded = false,
  budgetWithBills = 0,
  upcomingObligations = [],
  streakProps,
  thresholds = { tight: 20, normal: 30, good: 50 },
  budgetBreakdown,
  currency = "€",
}: DailyAllowanceProps) {
  const { t, locale, fmt, mask } = useLocale();
  const [infoOpen, setInfoOpen] = useState(false);
  const [budgetInfoOpen, setBudgetInfoOpen] = useState(false);
  const [billsInfoOpen, setBillsInfoOpen] = useState(false);
  const effectiveBudget = todaySpentAll > 0 ? Math.max(0, todayRemaining) : dailyBudget;
  const overspent = todayRemaining < 0;
  const status =
    effectiveBudget > thresholds.good ? "good" : effectiveBudget > thresholds.tight ? "tight" : "danger";

  // tomorrowBudget is recomputed by the engine on the money actually left,
  // passed in as a prop. Today's spend already reduced the balance.
  const tomorrowStatus = tomorrowBudget > thresholds.good ? "text-positive" : tomorrowBudget > thresholds.tight ? "text-chart-3" : "text-negative";
  const incomeCountdown = daysUntilIncome === 1
    ? (locale === "fi" ? "Huomenna tulee rahaa" : "Income arrives tomorrow")
    : `${mask(daysUntilIncome)} ${t.dashboard.daysUntilNextIncome}`;

  return (
    <div className="daily-allowance-grid">
      <Card className="daily-allowance-hero" data-status={status}>
        <div className="daily-allowance-hero-content">
          <p className="daily-allowance-hero-label metric-card-label-info">
            {todaySpentAll > 0
              ? (locale === "fi" ? "Tänään jäljellä" : "Remaining today")
              : t.dashboard.dailyBudget}
            <span className={`metric-info-wrap ${budgetInfoOpen ? "is-open" : ""}`}>
              <button type="button" className="metric-info-trigger" onClick={() => setBudgetInfoOpen((v) => !v)}>
                <Info />
              </button>
              <span className="metric-info-popup">
                {budgetBreakdown ? (() => {
                  const now2 = new Date();
                  const dim = new Date(now2.getFullYear(), now2.getMonth() + 1, 0).getDate();
                  const startAbs = budgetBreakdown.startDay + 1;
                  const endAbs = budgetBreakdown.endDay;
                  const startDay = startAbs > dim ? startAbs - dim : startAbs;
                  const endDay = endAbs > dim ? endAbs - dim : endAbs;
                  const startMonth = startAbs > dim ? now2.getMonth() + 2 : now2.getMonth() + 1;
                  const endMonth = endAbs > dim ? now2.getMonth() + 2 : now2.getMonth() + 1;
                  const range = startMonth === endMonth
                    ? `${startDay}.${startMonth}.\u2013${endDay}.${endMonth}.`
                    : `${startDay}.${startMonth}.\u2013${endDay}.${endMonth}.`;
                  return locale === "fi"
                    ? `Saldo: ${fmt(availableBalance)} €. Jakso: ${range} (${budgetBreakdown.days} pv). Pakolliset velvoitteet: ${fmt(budgetBreakdown.obligations)} €. Säästötavoite: ${fmt(budgetBreakdown.savingGoalDeducted)} €. Laskuja, velkoja ja tilauksia tulossa: ${fmt(upcomingBills)} €. Jos maksat kaikki, päiväbudjetti olisi ${fmt(budgetWithBills)} €/pv.`
                    : `Balance: ${fmt(availableBalance)} €. Window: ${range} (${budgetBreakdown.days}d). Must-pay: ${fmt(budgetBreakdown.obligations)} €. Savings: ${fmt(budgetBreakdown.savingGoalDeducted)} €. Bills, debts and subscriptions upcoming: ${fmt(upcomingBills)} €. If all paid, budget would be ${fmt(budgetWithBills)} €/day.`;
                })() : (locale === "fi" ? "Päiväbudjetti lasketaan jakamalla käytettävissä oleva raha tulojen välisiin jaksoihin" : "Daily budget calculated by splitting available money between income segments")}
              </span>
            </span>
          </p>
          <div className="daily-allowance-hero-amount">
            <span className="daily-allowance-hero-value" data-status={overspent ? "danger" : status}>
              <F v={overspent ? 0 : effectiveBudget} s={` ${currency}`} />
            </span>
            <span className="daily-allowance-hero-unit">{todaySpentAll > 0 ? "" : t.dashboard.perDay}</span>
          </div>
          <p className="daily-allowance-hero-note">
            {locale === "fi" ? (todaySpentAll > 0 ? "Tämän päivän kokonaisbudjetti oli " : "Tämän päivän kokonaisbudjetti on ") : (todaySpentAll > 0 ? "Today's total budget was " : "Today's total budget is ")}
            <span className={dailyBudget > thresholds.good ? "text-positive" : dailyBudget > thresholds.tight ? "text-chart-3" : "text-negative"}><F v={dailyBudget} s={` ${currency}`} /></span>
            {effectiveBudget > thresholds.good
              ? (locale === "fi" ? ". Rahaa on, mutta älä tuhlaa, säästä. " : ". You have money, but save, don't splurge. ")
              : effectiveBudget > thresholds.tight
              ? (locale === "fi" ? ". Vähän liikkumavaraa jäljellä. " : ". Some room left. ")
              : effectiveBudget > 0 && todaySpentAll > 0
              ? (locale === "fi" ? ". Budjetti on lähes käytetty. " : ". Budget is nearly used up. ")
              : ". "}
            {billsDelayNeeded ? (
              <>
                {locale === "fi"
                  ? "Jos maksaisit kaikki laskut, päiväbudjettisi olisi "
                  : "If you paid all bills, your daily budget would be "}
                {(() => {
                  const cls = budgetWithBills > 0 ? "text-positive" : "text-negative";
                  return <span className={cls}><F v={budgetWithBills} s={` ${currency}`} /></span>;
                })()}
                {". "}
                {locale === "fi" ? "Laskuja " : "Bills "}
                <span className="text-negative"><F v={upcomingBills} s={` ${currency}`} /></span>
                {". "}
                {locale === "fi" ? "Jos et käytä rahaa enää tänään, huomenna voit käyttää max " : "If you stop spending today, tomorrow you can spend max "}
                <span className={tomorrowStatus}><F v={tomorrowBudget} s={` ${currency}`} /></span>
                {daysUntilIncome > 0 && `. ${incomeCountdown}.`}
              </>
            ) : overspent ? (
              <>
                {locale === "fi" ? "Ylitetty " : "Exceeded by "}
                <span className="text-negative"><F v={Math.abs(todayRemaining)} s={` ${currency}`} /></span>
                {locale === "fi" ? " verran. Käytetty " : ". Spent "}
                <span className="text-negative"><F v={todaySpentAll} s={` ${currency}`} /></span>
                {". "}
                {locale === "fi" ? "Jos et käytä rahaa enää tänään, huomenna voit käyttää max " : "If you stop spending today, tomorrow you can spend max "}
                <span className={tomorrowStatus}><F v={tomorrowBudget} s={` ${currency}`} /></span>
                {daysUntilIncome > 0 && `. ${incomeCountdown}.`}
              </>
            ) : todaySpentAll > 0 ? (
              <>
                {locale === "fi" ? "Käytetty " : "Spent "}
                <span className="text-negative"><F v={todaySpentAll} s={` ${currency}`} /></span>
                {". "}
                {locale === "fi" ? "Jos et käytä rahaa enää tänään, huomenna voit käyttää max " : "If you stop spending today, tomorrow you can spend max "}
                <span className={tomorrowStatus}><F v={tomorrowBudget} s={` ${currency}`} /></span>
                {daysUntilIncome > 0 ? `. ${incomeCountdown}.` : "."}
              </>
            ) : (
              <>
                {locale === "fi" ? "Jos et käytä rahaa enää tänään, huomenna voit käyttää max " : "If you stop spending today, tomorrow you can spend max "}
                <span className={tomorrowStatus}><F v={tomorrowBudget} s={` ${currency}`} /></span>
                {daysUntilIncome > 0 ? `. ${incomeCountdown}.` : "."}
              </>
            )}
            {!billsDelayNeeded && !overspent && status === "danger" && ` ${t.dashboard.cutNonEssentials}.`}
            {!billsDelayNeeded && !overspent && status === "tight" && ` ${t.dashboard.beCareful}.`}
            {upcomingBills > 0 && (
              <> {locale === "fi" ? "Tulossa " : "Upcoming "}<span className="text-negative"><F v={upcomingBills} s={` ${currency}`} /></span>{locale === "fi" ? " laskuja ja velkoja." : " in bills and debts."}</>
            )}
          </p>
          {budgetNotice && (
            <div className="budget-notice">
              <span className="budget-notice-text">
                {(() => {
                  const reasons: string[] = [];
                  if (budgetNotice.obligationAmount > 0) {
                    reasons.push(locale === "fi"
                      ? `${budgetNotice.obligationName} (${fmt(budgetNotice.obligationAmount)} €) erääntyy ennen seuraavaa rahapäivää`
                      : `${budgetNotice.obligationName} (${fmt(budgetNotice.obligationAmount)} €) is due before your next payday`);
                  }
                  if (budgetNotice.savingReserve > 0) {
                    reasons.push(locale === "fi"
                      ? `säästötavoite (${fmt(budgetNotice.savingReserve)} €) varataan jaksolle`
                      : `your saving goal (${fmt(budgetNotice.savingReserve)} €) is reserved for the period`);
                  }
                  const joined = reasons.join(locale === "fi" ? " ja " : " and ");
                  return locale === "fi"
                    ? `Budjetti on pieni, koska ${joined}. Nämä varataan saldosta ennen päivittäistä käyttöä.`
                    : `Budget is low because ${joined}. These are reserved from your balance before daily spending.`;
                })()}
              </span>
              <Link href={budgetNotice.href} className="budget-notice-btn">
                {budgetNotice.linkTo === "saving"
                  ? (locale === "fi" ? "Säädä säästötavoitetta" : "Adjust saving goal")
                  : (locale === "fi" ? "Tarkista erääntymispäivä" : "Check due date")}
              </Link>
            </div>
          )}
        </div>
        <div className="daily-allowance-hero-bg">
          <Wallet />
        </div>
      </Card>

      {monthIncome > 0 && (
        <Card className="metric-card">
          <div className="metric-card-row">
            <div className="metric-card-icon" data-color={monthIncome - monthExpenses >= 0 ? "positive" : "negative"}>
              {monthIncome - monthExpenses >= 0 ? <ArrowDown /> : <ArrowUp />}
            </div>
            <div>
              <p className="metric-card-label metric-card-label-info">
                {locale === "fi" ? "Kuukauden tilanne" : "Month status"}
                <span className={`metric-info-wrap ${infoOpen ? "is-open" : ""}`}>
                  <button type="button" className="metric-info-trigger" onClick={() => setInfoOpen((v) => !v)}>
                    <Info />
                  </button>
                  <span className="metric-info-popup">
                    {locale === "fi"
                      ? "Tulot (odotetut tai saadut) miinus menot: toteutuneet kulut + maksamattomat laskut + arvioitu loppukuun kulutus + sijoitukset + velkaerät"
                      : "Income (expected or received) minus expenses: actual spending + unpaid bills + projected remaining spending + investments + debt payments"}
                  </span>
                </span>
              </p>
              <p className="metric-card-value">
                <span className={monthIncome - monthExpenses >= 0 ? "text-positive" : "text-negative"}>
                  {monthIncome - monthExpenses >= 0 ? <>+<F v={Math.abs(monthIncome - monthExpenses)} s={` ${currency}`} /></> : <>{"\u2212"}<F v={Math.abs(monthIncome - monthExpenses)} s={` ${currency}`} /></>}
                </span>
              </p>
              <p className="metric-card-note">
                {monthIncome - monthExpenses >= 0
                  ? (locale === "fi" ? "Plussalla" : "Surplus")
                  : (locale === "fi" ? "Miinuksella" : "Deficit")}
                {" \u00B7 "}{locale === "fi" ? "tulot " : "income "}<span className="text-positive"><F v={monthIncome} s={` ${currency}`} /></span>{", "}{locale === "fi" ? "menot (arvio) " : "expenses (est.) "}<span className="text-negative"><F v={monthExpenses} s={` ${currency}`} /></span>
              </p>
            </div>
          </div>
        </Card>
      )}

      {streakProps && <SavingsStreak {...streakProps} />}

      <Card className="metric-card">
        <div className="metric-card-row">
          <div className="metric-card-icon" data-color="primary">
            <Wallet />
          </div>
          <div>
            <p className="metric-card-label">{t.dashboard.available}</p>
            <p className="metric-card-value"><F v={availableBalance} s={` ${currency}`} /></p>
            {accountCount > 0 && <p className="metric-card-note">{mask(accountCount)} {locale === "fi" ? "tiliä" : "accounts"}</p>}
          </div>
        </div>
      </Card>

      <Card className="metric-card">
        <div className="metric-card-row">
          <div className="metric-card-icon" data-color="negative">
            <ArrowUp />
          </div>
          <div>
            <p className="metric-card-label">
              {t.dashboard.billsDue}
              <span className={`metric-info-wrap ${billsInfoOpen ? "is-open" : ""}`}>
                <button type="button" className="metric-info-trigger" onClick={() => setBillsInfoOpen((v) => !v)}>
                  <Info />
                </button>
                <span className="metric-info-popup">
                  {locale === "fi"
                    ? "Sisältää erääntyvät laskut, tilaukset ja velat: tämän kuun maksamattomat sekä pian erääntyvät. Laskut-sivu laskee vain toistuvat laskut, joten tämä summa voi olla suurempi."
                    : "Includes bills, subscriptions and debts due: this month's unpaid plus upcoming ones. The Bills page counts only recurring bills, so this total can be higher."}
                </span>
              </span>
            </p>
            <p className="metric-card-value"><F v={upcomingBills} s={` ${currency}`} /></p>
            {billCount > 0 && <p className="metric-card-note">{mask(billCount)} {locale === "fi" ? "laskua" : "bills"}</p>}
          </div>
        </div>
      </Card>

      <Card className="metric-card">
        <div className="metric-card-row">
          <div className="metric-card-icon" data-color="positive">
            <ArrowDown />
          </div>
          <div>
            <p className="metric-card-label">{t.dashboard.nextIncome}</p>
            <p className="metric-card-value"><F v={nextIncomeAmount} s={` ${currency}`} /></p>
            <p className="metric-card-note">{mask(nextIncomeDate)}</p>
          </div>
        </div>
      </Card>

      <Card className="metric-card">
        <div className="metric-card-row">
          <div className="metric-card-icon" data-color="chart-3">
            <CalendarClock />
          </div>
          <div>
            <p className="metric-card-label">{locale === "fi" ? "Kulutusvauhti" : "Burn rate"}</p>
            <p className="metric-card-value"><F v={burnRate} s={` ${currency}/${locale === "fi" ? "pv" : "day"}`} /></p>
            <p className="metric-card-note">
              {trendPercent !== 0 ? (
                <>
                  <span className={trendPercent > 0 ? "text-negative" : "text-positive"}>
                    {trendPercent > 0 ? "+" : ""}{mask(trendPercent)}%
                  </span>
                  {" "}{locale === "fi" ? "vs ed. viikko" : "vs last week"}
                </>
              ) : (
                locale === "fi" ? "keskiarvo tässä kuussa" : "average this month"
              )}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
