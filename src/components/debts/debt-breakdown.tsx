"use client";

import { Card } from "@/components/ui/card";
import { useLocale } from "@/lib/locale-context";
import { F } from "@/components/ui/f";

export interface DebtSlice {
  id: string;
  name: string;
  balance: number;
  paidThisMonth: number;
  percentPaid: number;
  effectiveOriginal: number;
}

const DEBT_COLORS = ["#f87171", "#fb923c", "#fbbf24", "#c084fc", "#f472b6", "#60a5fa", "#34d399", "#a3a3a3"];

// All debts on one bar: green is what has been paid off, each colour what one debt still owes. The
// debt-free date comes from the payoff plan at today's payments; months is 0 when it never ends.
export function DebtBreakdown({ debts, debtFreeMonths }: { debts: DebtSlice[]; debtFreeMonths: number }) {
  const { locale, mask } = useLocale();
  const fi = locale === "fi";

  const withColor = debts
    .filter((d) => d.balance > 0)
    .map((d, i) => ({ ...d, color: DEBT_COLORS[i % DEBT_COLORS.length] }));
  if (withColor.length === 0) return null;

  const remaining = withColor.reduce((s, d) => s + d.balance, 0);
  const original = withColor.reduce((s, d) => s + Math.max(d.effectiveOriginal, d.balance), 0);
  const paidOff = Math.max(0, original - remaining);
  const paidThisMonth = withColor.reduce((s, d) => s + d.paidThisMonth, 0);
  const percent = original > 0 ? Math.round((paidOff / original) * 1000) / 10 : 0;
  const share = (v: number) => `${original > 0 ? (v / original) * 100 : 0}%`;

  const freeDate = new Date();
  freeDate.setMonth(freeDate.getMonth() + debtFreeMonths);
  const freeMonth = freeDate.toLocaleDateString(fi ? "fi-FI" : "en-GB", { month: "long", year: "numeric" });
  const years = Math.floor(debtFreeMonths / 12);
  const months = debtFreeMonths % 12;
  const duration = fi
    ? [years ? `${years} v` : "", months ? `${months} kk` : ""].filter(Boolean).join(" ")
    : [years ? `${years} y` : "", months ? `${months} mo` : ""].filter(Boolean).join(" ");

  return (
    <Card className="debt-breakdown">
      <div className="debt-breakdown-top">
        <div>
          <p className="debt-breakdown-label">{fi ? "Velkaa jäljellä" : "Debt remaining"}</p>
          <p className="debt-breakdown-total"><F v={remaining} /></p>
          <p className="debt-breakdown-sub">
            {mask(`${percent} %`)} {fi ? "maksettu alkuperäisestä" : "paid off of"} <F v={original} />
          </p>
        </div>
        {debtFreeMonths > 0 && (
          <div className="debt-breakdown-free">
            <p className="debt-breakdown-label">{fi ? "Velaton arviolta" : "Debt-free around"}</p>
            <p className="debt-breakdown-month">{freeMonth}</p>
            <p className="debt-breakdown-sub">{duration} {fi ? "nykyisillä maksuilla" : "at today's payments"}</p>
          </div>
        )}
      </div>

      <div className="debt-breakdown-bar" role="img" aria-label={fi ? `Maksettu ${percent} %` : `${percent} % paid off`}>
        {paidOff > 0 && <span style={{ width: share(paidOff), backgroundColor: "var(--positive)" }} />}
        {withColor.map((d) => (
          <span key={d.id} style={{ width: share(d.balance), backgroundColor: d.color }} title={d.name} />
        ))}
      </div>
      <div className="debt-breakdown-key">
        <span><i style={{ backgroundColor: "var(--positive)" }} />{fi ? "Maksettu" : "Paid off"} <F v={paidOff} /></span>
        {withColor.map((d) => (
          <span key={d.id}><i style={{ backgroundColor: d.color }} />{d.name}</span>
        ))}
      </div>

      <div className="debt-breakdown-tiles">
        {withColor.map((d) => (
          <div key={d.id} className="debt-breakdown-tile">
            <span className="debt-breakdown-tile-name"><i style={{ backgroundColor: d.color }} />{d.name}</span>
            <span className="debt-breakdown-tile-amount"><F v={d.balance} /></span>
            <span className="debt-breakdown-tile-meta">
              {mask(`${Math.round((d.balance / remaining) * 100)} %`)} {fi ? "veloista" : "of debts"}
              {d.paidThisMonth > 0 && <b> · +<F v={d.paidThisMonth} /> {fi ? "tässä kuussa" : "this month"}</b>}
            </span>
          </div>
        ))}
      </div>

      {paidThisMonth > 0 && (
        <div className="debt-breakdown-foot">
          <span>{fi ? "Maksettu yhteensä tässä kuussa" : "Paid this month in total"}</span>
          <b><F v={paidThisMonth} /></b>
        </div>
      )}
    </Card>
  );
}
