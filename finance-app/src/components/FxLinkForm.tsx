"use client";

import { useEffect, useId, useState } from "react";
import { formatMoney, formatDate, parseMoney } from "@/lib/format";
import { fetchFxHint } from "@/lib/obligation-link";
import { cbrFromPayment, formatRate, formatRateDate } from "@/lib/obligation-link-calc";

export type FxLinkValue = {
  amount: number; // валюта начисления
  paymentAmount: number; // валюта операции
  method: "CBR" | "MANUAL";
  rate: number | null; // курс ЦБ из подсказки (обязателен для CBR)
  rateDate: string | null;
};

const toInput = (minor: number) => (minor / 100).toFixed(2).replace(".", ",");
const minorUnitText = (cur: string) => (cur === "RUB" ? "1 копейки" : `0,01 ${cur}`);

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
  const [capped, setCapped] = useState(false); // сумма по курсу упёрлась в долг
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
        const d = cbrFromPayment(available, outstanding, h.rate);
        setRate(h.rate); setRateDate(h.rateDate); setRateError(null); setManual(false); setCapped(d.capped);
        setAmountStr(toInput(d.amount)); setPaymentStr(toInput(d.payment));
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [payCurrency, oblCurrency, date, available, outstanding]);

  // В режиме ЦБ рубли следуют за списанием, но не больше долга; если упёрлись —
  // списание пересчитывается обратно при выходе из поля (и перед отправкой).
  function changePayment(v: string) {
    setPaymentStr(v); setError(null);
    if (!manual && rate !== null) {
      const d = cbrFromPayment(parseMoney(v), outstanding, rate);
      setAmountStr(toInput(d.amount)); setCapped(d.capped);
    }
  }
  function blurPayment() {
    if (manual || rate === null) return;
    const d = cbrFromPayment(parseMoney(paymentStr), outstanding, rate);
    if (d.capped) setPaymentStr(toInput(d.payment));
  }
  function changeAmount(v: string) {
    setAmountStr(v); setError(null);
    setManual(true); setCapped(false);
  }
  function resetToCbr() {
    if (rate === null) return;
    const d = cbrFromPayment(available, outstanding, rate);
    setManual(false); setError(null); setCapped(d.capped);
    setAmountStr(toInput(d.amount)); setPaymentStr(toInput(d.payment));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    let payment = parseMoney(paymentStr);
    let amount = parseMoney(amountStr);
    const cbr = !manual && rate !== null;
    if (!manual && rate !== null && payment > 0) {
      const d = cbrFromPayment(payment, outstanding, rate);
      payment = d.payment; amount = d.amount;
      setPaymentStr(toInput(payment)); setAmountStr(toInput(amount));
    }
    if (payment <= 0) return setError(`Укажите, сколько ${payCurrency} списать из операции`);
    if (payment > available) return setError(`Не больше остатка операции: ${formatMoney(available, payCurrency)}`);
    if (amount <= 0) {
      return setError(cbr
        ? `По курсу ЦБ это меньше ${minorUnitText(oblCurrency)} — привязать нельзя. Увеличьте сумму списания или введите сумму в ${oblCurrency} вручную.`
        : `Укажите сумму в ${oblCurrency}`);
    }
    if (amount > outstanding) return setError(`Не больше долга по начислению: ${formatMoney(outstanding, oblCurrency)}`);
    onSubmit({ amount, paymentAmount: payment, method: cbr ? "CBR" : "MANUAL", rate: cbr ? rate : null, rateDate: rate !== null ? rateDate : null });
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
              {formatMoney(payment, payCurrency)} × {formatRate(rate)} (ЦБ {rateDate ? formatRateDate(rateDate, 0) : "—"}) = {formatMoney(amount, oblCurrency)}
              {!manual && capped && <div className="mt-1 text-slate-400">Урезано до долга по начислению, списание пересчитано по курсу ЦБ</div>}
              {!manual && !capped && amount === 0 && payment > 0 && (
                <div className="mt-1 text-amber-700 dark:text-amber-400">Остаток меньше {minorUnitText(oblCurrency)} по курсу ЦБ — привязать нельзя</div>
              )}
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
          <input id={`${uid}-pay`} value={paymentStr} onChange={(e) => changePayment(e.target.value)} onBlur={blurPayment}
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
