"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate, parseMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import { loadLinkCandidates, obligationLink, type LinkCandidate, type LinkResult } from "@/lib/obligation-link";
import AnchoredPopover from "@/components/AnchoredPopover";
import FxLinkForm, { type FxLinkValue } from "@/components/FxLinkForm";

type Obl = { id: string; outstanding: number; currency: string; due_date: string | null; note: string | null };

const toInput = (minor: number) => (minor / 100).toFixed(2).replace(".", ",");

// Разнесение конкретной выплаты по открытым обязательствам контрагента.
// Одну операцию можно «разрезать» на несколько частей (несколько строк
// obligation_payments на одну транзакцию, 0072). Запись — RPC obligation_link (0099):
// остаток операции — в её валюте; начисление в другой валюте — через шаг курса ЦБ.
export default function AllocatePaymentButton({
  paymentId,
  counterpartyId,
  oblType,
}: {
  paymentId: string;
  counterpartyId: string;
  oblType: "receivable" | "payable";
}) {
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const reqId = useRef<string>("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [obls, setObls] = useState<Obl[]>([]);
  // Операция с остатком в её валюте (null — операция уже разнесена / не найдена)
  const [tx, setTx] = useState<LinkCandidate | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false); // были ли изменения (нужен ли refresh при закрытии)
  const [selected, setSelected] = useState<Obl | null>(null);
  const [amountStr, setAmountStr] = useState("");

  async function load() {
    setOpen(true);
    setLoading(true);
    setLoadError(null);
    setDirty(false);
    setSelected(null);
    const supabase = createClient();
    const txType = oblType === "payable" ? "expense" : "income";
    const [cand, { data: bal, error: balErr }, { data: linked, error: linkedErr }] = await Promise.all([
      loadLinkCandidates(supabase, { counterpartyId, txType, transactionId: paymentId }),
      supabase
        .from("obligation_balances")
        .select("id, outstanding, currency, due_date, note")
        .eq("counterparty_id", counterpartyId)
        .eq("type", oblType)
        .gt("outstanding", 0)
        .order("due_date", { ascending: true }),
      supabase.from("obligation_payments").select("obligation_id").eq("transaction_id", paymentId),
    ]);
    if (cand.error || balErr || linkedErr) {
      setLoadError(cand.error ?? "Не удалось загрузить обязательства. Попробуйте ещё раз.");
      setLoading(false);
      return;
    }
    const t = cand.cands[0] ?? null;
    setTx(t);
    setRemaining(t?.remaining ?? null);
    const already = new Set((linked ?? []).map((l) => l.obligation_id as string));
    setObls(((bal ?? []) as Obl[]).filter((o) => !already.has(o.id)));
    setLoading(false);
  }

  function close() {
    setOpen(false);
    setSelected(null);
    if (dirty) router.refresh(); // синхронизируем страницу только если что-то разнесли
  }

  // Та же валюта: не больше остатка выплаты и не больше долга (переплату не допускаем).
  function maxFor(o: Obl): number {
    return Math.min(remaining ?? 0, o.outstanding);
  }

  function pick(o: Obl) {
    reqId.current = crypto.randomUUID(); // один ключ на это разнесение: двойной клик не задвоит
    setSelected(o);
    setAmountStr(toInput(maxFor(o)));
  }

  function applied(o: Obl, res: LinkResult | null, amount: number, payment: number) {
    toast.success(`Разнесено ${formatMoney(res?.amount ?? amount, o.currency)}`);
    const newOut = res?.obligation_outstanding ?? o.outstanding - amount;
    const newRemaining = res?.transaction_remaining ?? (remaining ?? 0) - payment;
    setDirty(true);
    setObls((list) =>
      newOut <= 0 ? list.filter((x) => x.id !== o.id) : list.map((x) => (x.id === o.id ? { ...x, outstanding: newOut } : x)),
    );
    setRemaining(newRemaining);
    setSelected(null);
    if (newRemaining <= 0) {
      setOpen(false);
      router.refresh();
    }
  }

  async function allocateSame() {
    if (!selected || !tx || busy) return;
    const amount = parseMoney(amountStr);
    const max = maxFor(selected);
    if (amount <= 0) return toast.error("Введите сумму больше нуля");
    if (amount > max) return toast.error(`Не больше ${formatMoney(max, selected.currency)} (остаток выплаты / долг обязательства)`);
    setBusy(true);
    // RPC блокирует обязательство и операцию и отклоняет переплату — проверка выше
    // только подсказка; request_id защищает от double submit и ретрая после таймаута.
    const { data, error } = await obligationLink(createClient(), {
      obligationId: selected.id, transactionId: tx.id, amount, requestId: reqId.current,
    });
    setBusy(false);
    if (error) return void toast.error(error);
    applied(selected, data, amount, amount);
  }

  async function allocateFx(v: FxLinkValue) {
    if (!selected || !tx || busy) return;
    setBusy(true);
    const { data, error } = await obligationLink(createClient(), {
      obligationId: selected.id, transactionId: tx.id, amount: v.amount, requestId: reqId.current,
      fx: { paymentAmount: v.paymentAmount, method: v.method, rateDate: v.rateDate },
    });
    setBusy(false);
    if (error) return void toast.error(error);
    applied(selected, data, v.amount, v.paymentAmount);
  }

  const header = loading
    ? "Куда разнести"
    : tx && remaining !== null
      ? `Куда разнести · остаток ${formatMoney(remaining, tx.currency)}`
      : "Куда разнести";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : load())}
        aria-expanded={open}
        className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand/90"
      >
        Разнести
      </button>
      {open && (
        <AnchoredPopover
          anchorRef={btnRef}
          onClose={close}
          className="max-h-96 w-80 max-w-[calc(100vw-16px)] overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-left shadow-xl dark:border-white/10 dark:bg-[#1b1d22]"
        >
        <div className="px-2 py-1.5 text-xs text-slate-400">{header}</div>

        {loading ? (
          <div className="px-2 py-3 text-sm text-slate-400" aria-live="polite">Загрузка…</div>
        ) : loadError ? (
          <div role="alert" className="px-2 py-3 text-sm text-red-600 dark:text-red-400">{loadError}</div>
        ) : !tx ? (
          <div className="px-2 py-3 text-sm text-slate-400">Операция уже полностью разнесена.</div>
        ) : remaining === null ? (
          <div role="status" className="px-2 py-3 text-sm text-amber-700 dark:text-amber-400">
            Нужна сверка: у прежних привязок этой операции нет суммы в {tx.currency}. Разнесение недоступно до исправления.
          </div>
        ) : selected && selected.currency !== tx.currency ? (
          // Шаг 2 (другая валюта) — подтверждение курса ЦБ.
          <FxLinkForm
            payCurrency={tx.currency}
            oblCurrency={selected.currency}
            date={tx.occurred_on}
            available={remaining}
            outstanding={selected.outstanding}
            busy={busy}
            submitLabel="Разнести"
            onSubmit={allocateFx}
            onBack={() => setSelected(null)}
          />
        ) : selected ? (
          // Шаг 2 (та же валюта) — сумма части.
          <div className="p-2">
            <button type="button" onClick={() => setSelected(null)} className="mb-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200">← к списку</button>
            <div className="mb-1 truncate text-sm text-slate-600 dark:text-neutral-300">
              {selected.due_date ? formatDate(selected.due_date) : "—"}{selected.note ? ` · ${selected.note}` : ""}
            </div>
            <div className="mb-2 text-xs text-slate-400">Долг {formatMoney(selected.outstanding, selected.currency)} · можно до {formatMoney(maxFor(selected), selected.currency)}</div>
            <div className="flex items-center gap-2">
              <input
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") allocateSame(); }}
                inputMode="decimal"
                autoFocus
                aria-label={`Сумма, ${selected.currency}`}
                className="input py-1.5 text-sm"
                placeholder="0,00"
              />
              <button type="button" onClick={() => setAmountStr(toInput(maxFor(selected)))} className="shrink-0 rounded-lg px-2 py-1 text-xs text-brand hover:bg-brand/10" title="Разнести всё доступное">Всё</button>
            </div>
            <button
              type="button"
              onClick={allocateSame}
              disabled={busy}
              className="mt-2 w-full rounded-lg bg-brand px-2.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-50"
            >
              {busy ? "…" : "Разнести часть"}
            </button>
          </div>
        ) : obls.length > 0 ? (
          // Шаг 1 — выбор обязательства.
          obls.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => pick(o)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-white/[0.06]"
            >
              <span className="min-w-0 truncate text-slate-600 dark:text-neutral-300">
                {o.due_date ? formatDate(o.due_date) : "—"}
                {o.note ? ` · ${o.note}` : ""}
                {o.currency !== tx.currency && <span className="text-slate-400"> · по курсу ЦБ</span>}
              </span>
              <span className="shrink-0 font-medium tabular-nums text-slate-800 dark:text-neutral-100">
                {formatMoney(o.outstanding, o.currency)}
              </span>
            </button>
          ))
        ) : (
          <div className="px-2 py-3 text-sm text-slate-400">
            {dirty ? "Все обязательства этого контрагента закрыты." : "Нет открытых обязательств этого контрагента."}
          </div>
        )}
        </AnchoredPopover>
      )}
    </>
  );
}
