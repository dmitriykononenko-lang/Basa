"use client";

import { useEffect, useId, useState } from "react";
import { formatMoney, formatDate, parseMoney } from "@/lib/format";
import { fetchFxHint } from "@/lib/obligation-link";
import { convertByRate, formatRate, formatRateDate, fxDefaults } from "@/lib/obligation-link-calc";

export type FxLinkValue = {
  amount: number; // валюта начисления
  paymentAmount: number; // валюта операции
  method: "CBR" | "MANUAL";
  rateDate: string | null;
};

const toInput = (minor: number) => (minor / 100).toFixed(2).replace(".", ",");

// Шаг подтверждения курса для привязки операции в другой валюте к начислению.
// Подсказка — курс ЦБ на дату операции; сумму в валюте начисления можно поправить
// (тогда fx_method = MANUAL). Нет курса — сумма вводится вручную.
export default function FxLinkForm({
  payCurrency, oblCurrency, date, available, outstanding, busy, submitLabel = "Привязать", onSubmit, onBack,
}: {
  payCurrency: string;
  oblCurrency: string;
  date: string; // дата операции, YYYY-MM-DD
  available: number; // непривязанный остаток операции, валюта операции
  outstanding: number; // долг начисления, валюта начисления
  busy: boolean;
  submitLabel?: string;
  onSubmit: (v: FxLinkValue) => void;
  onBack: () => void;
}) {
  const uid = useId();
  const [loading, setLoading] = useState(true);
  const [rate, setRate] = useState<number | null>(null);
  const [rateDate, setRateDate] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [paymentStr, setPaymentStr] = useState(toInput(available));
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchFxHint(payCurrency, oblCurrency, date).then((h) => {
      if (!alive) return;
      if (h.rate === null) {
        setRate(null); setRateDate(null); setRateError(h.error); setManual(true);
        setPaymentStr(toInput(available)); setAmountStr("");
      } else {
        const d = fxDefaults(available, outstanding, h.rate);
        setRate(h.rate); setRateDate(h.rateDate); setRateError(null); setManual(false);
        setAmountStr(toInput(d.amount)); setPaymentStr(toInput(d.payment));
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [payCurrency, oblCurrency, date, available, outstanding]);

  function changePayment(v: string) {
    setPaymentStr(v); setError(null);
    if (!manual && rate !== null) setAmountStr(toInput(convertByRate(parseMoney(v), rate)));
  }
  function changeAmount(v: string) {
    setAmountStr(v); setError(null);
    setManual(true);
  }
  function resetToCbr() {
    if (rate === null) return;
    const d = fxDefaults(available, outstanding, rate);
    setManual(false); setError(null);
    setAmountStr(toInput(d.amount)); setPaymentStr(toInput(d.payment));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payment = parseMoney(paymentStr);
    const amount = parseMoney(amountStr);
    if (payment <= 0) return setError(`Укажите, сколько ${payCurrency} списать из операции`);
    if (payment > available) return setError(`Не больше остатка операции: ${formatMoney(available, payCurrency)}`);
    if (amount <= 0) return setError(`Укажите сумму в ${oblCurrency}`);
    if (amount > outstanding) return setError(`Не больше долга по начислению: ${formatMoney(outstanding, oblCurrency)}`);
    onSubmit({ amount, paymentAmount: payment, method: manual ? "MANUAL" : "CBR", rateDate: rate !== null ? rateDate : null });
  }

  const payment = parseMoney(paymentStr);
  const amount = parseMoney(amountStr);

  return (
    <form onSubmit={submit} className="p-2">
      <button type="button" onClick={onBack} className="mb-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200">← к списку</button>
      <div className="mb-2 text-xs text-slate-500 dark:text-neutral-400">
        Операция {formatDate(date)} в {payCurrency}, начисление в {oblCurrency}. Остаток операции {formatMoney(available, payCurrency)}, долг {formatMoney(outstanding, oblCurrency)}.
      </div>

      {loading ? (
        <div className="py-2 text-sm text-slate-400" aria-live="polite">Загружаем курс ЦБ…</div>
      ) : (
        <>
          {rate !== null ? (
            <div className="mb-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs tabular-nums text-slate-600 dark:bg-white/[0.04] dark:text-neutral-300">
              {formatMoney(payment, payCurrency)} × {formatRate(rate)} (ЦБ {rateDate ? formatRateDate(rateDate, 0) : "—"}) = {formatMoney(convertByRate(payment, rate), oblCurrency)}
              {manual && (
                <div className="mt-1 flex items-center justify-between gap-2 text-amber-700 dark:text-amber-400">
                  <span>Сумма в {oblCurrency} изменена вручную</span>
                  <button type="button" onClick={resetToCbr} className="shrink-0 text-brand hover:underline">Вернуть курс ЦБ</button>
                </div>
              )}
            </div>
          ) : (
            <div role="status" className="mb-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              {rateError ?? "Курс ЦБ недоступен"}. Введите сумму в {oblCurrency} вручную.
            </div>
          )}

          <label htmlFor={`${uid}-pay`} className="mb-0.5 block text-xs text-slate-500 dark:text-neutral-400">Списать из операции, {payCurrency}</label>
          <input id={`${uid}-pay`} value={paymentStr} onChange={(e) => changePayment(e.target.value)}
            inputMode="decimal" className="input mb-2 py-1.5 text-sm" placeholder="0,00" />

          <label htmlFor={`${uid}-amt`} className="mb-0.5 block text-xs text-slate-500 dark:text-neutral-400">Зачесть в начисление, {oblCurrency}</label>
          <input id={`${uid}-amt`} value={amountStr} onChange={(e) => changeAmount(e.target.value)}
            inputMode="decimal" autoFocus={rate === null} className="input py-1.5 text-sm" placeholder="0,00" />
          {rate !== null && amount > 0 && payment > 0 && manual && (
            <div className="mt-1 text-xs tabular-nums text-slate-400">Фактический курс {formatRate(amount / payment)}</div>
          )}

          {error && <div role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>}

          <button type="submit" disabled={busy}
            className="mt-2 w-full rounded-lg bg-brand px-2.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-50">
            {busy ? "…" : submitLabel}
          </button>
        </>
      )}
    </form>
  );
}
