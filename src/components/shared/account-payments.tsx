"use client";

import { useLocale } from "@/lib/locale-context";
import { formatDateShort } from "@/lib/date-utils";
import { F } from "@/components/ui/f";

export interface AccountPayment {
  id: string;
  date: string;
  amount: number;
  payee: string;
  memo: string;
}

// Everything booked on a debt or investment, newest first. A positive amount always helps: it lowers
// a debt or grows an investment.
export function AccountPayments({ payments }: { payments?: AccountPayment[] }) {
  const { locale } = useLocale();
  if (!payments || payments.length === 0) return null;
  const fi = locale === "fi";
  const label = (p: AccountPayment) => {
    if (p.payee.startsWith("Reconciliation")) return fi ? "Saldon korjaus" : "Balance adjustment";
    if (p.payee.startsWith("Starting Balance")) return fi ? "Alkusaldo" : "Starting balance";
    if (p.payee.startsWith("Transfer : ")) return `${fi ? "Tililtä" : "From"} ${p.payee.slice("Transfer : ".length)}`;
    return p.payee;
  };
  return (
    <details className="account-payments">
      <summary className="account-payments-summary">{fi ? "Maksut" : "Payments"} ({payments.length})</summary>
      <ul className="account-payments-list">
        {payments.map((p) => (
          <li key={p.id} className="account-payments-row">
            <span className="account-payments-date">{formatDateShort(p.date)}</span>
            <span className="account-payments-payee">{label(p)}{p.memo ? <span className="account-payments-memo"> · {p.memo}</span> : null}</span>
            <span className={`account-payments-amount ${p.amount > 0 ? "is-positive" : ""}`}>{p.amount > 0 ? "+" : ""}<F v={p.amount} /></span>
          </li>
        ))}
      </ul>
    </details>
  );
}
