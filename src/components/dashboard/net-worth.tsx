"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { useLocale } from "@/lib/locale-context";
import { F } from "@/components/ui/f";
import { TrendingDown, Landmark, PiggyBank, Clock } from "lucide-react";

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
}

interface NetWorthProps {
  accounts: Account[];
}

export function NetWorth({ accounts }: NetWorthProps) {
  const { t, locale } = useLocale();
  const [ageOfMoney, setAgeOfMoney] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/age-of-money").then((r) => r.json()).then((d) => { if (typeof d.ageOfMoney === "number") setAgeOfMoney(d.ageOfMoney); }).catch(() => {});
  }, []);

  const investments = accounts.filter((a) => a.type === "otherAsset");
  const debts = accounts.filter((a) => a.type === "otherDebt");
  const checking = accounts.filter((a) => a.type === "checking" || a.type === "savings");

  const investmentTotal = investments.reduce((s, a) => s + a.balance, 0);
  const debtTotal = debts.reduce((s, a) => s + a.balance, 0);
  const checkingTotal = checking.reduce((s, a) => s + a.balance, 0);
  const netWorth = accounts.reduce((s, a) => s + a.balance, 0);

  return (
    <div className="net-worth-section">
      <div className="net-worth-grid">
        <Card className="net-worth-hero">
          <p className="net-worth-hero-label">{t.dashboard.netWorth}</p>
          <p className="net-worth-hero-value" data-positive={netWorth >= 0 || undefined}>
            <F v={netWorth} />
          </p>
        </Card>

        <Card className="net-worth-card">
          <div className="net-worth-card-row">
            <div className="net-worth-card-icon" data-color="primary">
              <Landmark />
            </div>
            <div>
              <p className="net-worth-card-label">{t.dashboard.accounts}</p>
              <p className="net-worth-card-value"><F v={checkingTotal} /></p>
            </div>
          </div>
        </Card>

        <Card className="net-worth-card">
          <div className="net-worth-card-row">
            <div className="net-worth-card-icon" data-color="positive">
              <PiggyBank />
            </div>
            <div>
              <p className="net-worth-card-label">{t.dashboard.investments}</p>
              <p className="net-worth-card-value text-positive"><F v={investmentTotal} /></p>
            </div>
          </div>
        </Card>

        <Card className="net-worth-card">
          <div className="net-worth-card-row">
            <div className="net-worth-card-icon" data-color="negative">
              <TrendingDown />
            </div>
            <div>
              <p className="net-worth-card-label">{t.debts.title}</p>
              <p className="net-worth-card-value text-negative"><F v={debtTotal} /></p>
            </div>
          </div>
        </Card>

        {ageOfMoney != null && (() => {
          const tone = ageOfMoney >= 14 ? "text-positive" : ageOfMoney >= 7 ? "text-warning" : "text-negative";
          return (
            <Card className="net-worth-card" title={locale === "fi" ? "Kauanko rahasi riittää nykyisellä kulutuksella" : "How long your money lasts at the current spending rate"}>
              <div className="net-worth-card-row">
                <div className="net-worth-card-icon" data-color="primary">
                  <Clock />
                </div>
                <div>
                  <p className="net-worth-card-label">{locale === "fi" ? "Rahan ikä" : "Age of money"}</p>
                  <p className={`net-worth-card-value ${tone}`}>{ageOfMoney} {locale === "fi" ? "pv" : "days"}</p>
                </div>
              </div>
            </Card>
          );
        })()}
      </div>

      {investments.length > 0 && (
        <Card className="net-worth-list">
          <h4 className="net-worth-list-heading">{t.dashboard.investments}</h4>
          {investments.map((a) => (
            <div key={a.id} className="net-worth-list-item">
              <span className="net-worth-list-name">{a.name}</span>
              <span className="net-worth-list-amount"><F v={a.balance} /></span>
            </div>
          ))}
        </Card>
      )}

      {debts.length > 0 && (
        <Card className="net-worth-list">
          <h4 className="net-worth-list-heading">{t.debts.title}</h4>
          {debts.map((a) => (
            <div key={a.id} className="net-worth-list-item">
              <span className="net-worth-list-name">{a.name}</span>
              <span className="net-worth-list-amount net-worth-list-amount-debt"><F v={a.balance} /></span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
