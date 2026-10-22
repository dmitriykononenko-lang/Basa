"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";
import { loadLinkCandidates, obligationLink, type LinkCandidate, type LinkResult } from "@/lib/obligation-link";
import { fxLabel } from "@/lib/obligation-link-calc";
import AnchoredPopover from "@/components/AnchoredPopover";
import FxLinkForm, { type FxLinkValue } from "@/components/FxLinkForm";

// Привязка существующей операции (выплаты/оплаты контрагенту) к начислению.
// Запись — только RPC obligation_link (0099): amount — в валюте начисления,
// payment_amount — в валюте операции; для другой валюты — шаг подтверждения курса ЦБ.
export default function LinkPaymentButton({
  obligationId, oblType, counterpartyId, currency, outstanding, teamId,
}: {
  obligationId: string;
  oblType: "receivable" | "payable";
  counterpartyId: string | null;
  currency: string; // валюта начисления
  outstanding: number; // долг, валюта начисления
  teamId: string;
}) {
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  // Ключ идемпотентности — один на кандидата за открытие поповера: двойной клик
  // или повтор после таймаута не создадут вторую привязку.
  const reqIds = useRef(new Map<string, string>());
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cands, setCands] = useState<LinkCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fxFor, setFxFor] = useState<LinkCandidate | null>(null);

  if (outstanding <= 0 || !counterpartyId) return null;
  const cpId = counterpartyId;
  const txType = oblType === "payable" ? "expense" : "income";

  function reqId(txId: string) {
    let id = reqIds.current.get(txId);
    if (!id) { id = crypto.randomUUID(); reqIds.current.set(txId, id); }
    return id;
  }

  async function load() {
    setOpen(true); setLoading(true); setLoadError(null); setFxFor(null);
    reqIds.current = new Map();
    const { cands: list, error } = await loadLinkCandidates(createClient(), { teamId, counterpartyId: cpId, txType });
    setLoadError(error);
    setCands(list);
    setLoading(false);
  }

  function done(res: LinkResult | null, fallbackAmount: number) {
    setOpen(false);
    setFxFor(null);
    const amount = res?.amount ?? fallbackAmount;
    let fx = "";
    if (res && res.payment_currency && res.payment_currency !== currency && res.payment_amount != null) {
      const label = fxLabel(res.fx_method, res.fx_rate, res.fx_rate_date);
      fx = ` (${[formatMoney(res.payment_amount, res.payment_currency), label].filter(Boolean).join(" ")})`;
    }
    toast.success(`Привязано ${formatMoney(amount, currency)}${fx}`);
    router.refresh();
  }

  async function linkSame(t: LinkCandidate) {
    if (busy || t.remaining === null) return;
    const amount = Math.min(t.remaining, outstanding);
    setBusy(true);
    const { data, error } = await obligationLink(createClient(), {
      obligationId, transactionId: t.id, amount, requestId: reqId(t.id),
    });
    setBusy(false);
    if (error) { toast.error(error); return; }
    done(data, amount);
  }

  async function linkFx(t: LinkCandidate, v: FxLinkValue) {
    if (busy) return;
    setBusy(true);
    const { data, error } = await obligationLink(createClient(), {
      obligationId, transactionId: t.id, amount: v.amount, requestId: reqId(t.id),
      fx: { paymentAmount: v.paymentAmount, method: v.method, rate: v.rate, rateDate: v.rateDate },
    });
    setBusy(false);
    if (error) { toast.error(error); return; }
    done(data, v.amount);
  }

  function pick(t: LinkCandidate) {
    if (t.remaining === null) return;
    if (t.currency === currency) void linkSame(t);
    else setFxFor(t);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : load())}
        aria-expanded={open}
        className="rounded-full px-3 py-1 text-xs font-medium text-brand transition hover:bg-brand/5"
      >
        Привязать
      </button>
      {open && (
        <AnchoredPopover
          anchorRef={btnRef}
          onClose={() => setOpen(false)}
          className="max-h-96 w-80 max-w-[calc(100vw-16px)] overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-left shadow-xl dark:border-white/10 dark:bg-[#1b1d22]"
        >
          {fxFor && fxFor.remaining !== null ? (
            <FxLinkForm
              payCurrency={fxFor.currency}
              oblCurrency={currency}
              date={fxFor.occurred_on}
              available={fxFor.remaining}
              outstanding={outstanding}
              busy={busy}
              onSubmit={(v) => linkFx(fxFor, v)}
              onBack={() => setFxFor(null)}
            />
          ) : (
            <>
              <div className="px-2 py-1.5 text-xs text-slate-400">{txType === "expense" ? "Выплата" : "Оплата"} этому контрагенту (непривязанный остаток)</div>
              {loading ? (
                <div className="px-2 py-3 text-sm text-slate-400" aria-live="polite">Загрузка…</div>
              ) : loadError ? (
                <div role="alert" className="px-2 py-3 text-sm text-red-600 dark:text-red-400">{loadError}</div>
              ) : cands.length > 0 ? (
                cands.map((t) => {
                  const review = t.remaining === null;
                  return (
                    <button key={t.id} type="button" onClick={() => pick(t)} disabled={busy || review}
                      title={review ? "Есть старые привязки без суммы в валюте операции — нужна сверка" : undefined}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent dark:hover:bg-white/[0.06]">
                      <span className="min-w-0 truncate text-slate-600 dark:text-neutral-300">
                        {formatDate(t.occurred_on)}{t.note ? ` · ${t.note}` : ""}{t.isSplit ? " · часть" : ""}
                        {t.currency !== currency && <span className="text-slate-400"> · {t.currency}</span>}
                      </span>
                      {review ? (
                        <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">нужна сверка</span>
                      ) : (
                        <span className="shrink-0 font-medium tabular-nums text-slate-800 dark:text-neutral-100">{formatMoney(t.remaining ?? 0, t.currency)}</span>
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="px-2 py-3 text-sm text-slate-400">Нет операций с непривязанным остатком.</div>
              )}
              {!loading && cands.some((t) => t.currency !== currency && t.remaining !== null) && (
                <div className="px-2 pb-1.5 pt-1 text-xs text-slate-400">Для операций в другой валюте сумму в {currency} подскажет курс ЦБ на дату операции.</div>
              )}
            </>
          )}
        </AnchoredPopover>
      )}
    </>
  );
}
