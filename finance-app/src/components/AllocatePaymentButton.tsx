"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate, parseMoney } from "@/lib/format";
import { toast } from "@/lib/toast";

type Obl = { id: string; outstanding: number; currency: string; due_date: string | null; note: string | null };

// Разнесение конкретной выплаты по открытым обязательствам контрагента.
// Одну операцию можно «разрезать» на несколько частей с произвольными суммами
// (несколько строк obligation_payments на одну транзакцию, см. миграцию 0072).
export default function AllocatePaymentButton({
  paymentId,
  occurredOn,
  remainingBase,
  baseCurrency,
  counterpartyId,
  oblType,
  userId,
}: {
  paymentId: string;
  occurredOn: string;
  remainingBase: number;
  baseCurrency: string;
  counterpartyId: string;
  oblType: "receivable" | "payable";
  userId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [obls, setObls] = useState<Obl[]>([]);
  // Локальный остаток выплаты — уменьшается по мере разнесения частей без перезагрузки.
  const [remaining, setRemaining] = useState(remainingBase);
  const [dirty, setDirty] = useState(false); // были ли изменения (нужен ли refresh при закрытии)
  const [selected, setSelected] = useState<Obl | null>(null);
  const [amountStr, setAmountStr] = useState("");

  async function load() {
    setOpen(true);
    setLoading(true);
    setRemaining(remainingBase);
    setDirty(false);
    setSelected(null);
    const supabase = createClient();
    const [{ data: bal }, { data: linked }] = await Promise.all([
      supabase
        .from("obligation_balances")
        .select("id, outstanding, currency, due_date, note")
        .eq("counterparty_id", counterpartyId)
        .eq("type", oblType)
        .gt("outstanding", 0)
        .order("due_date", { ascending: true }),
      supabase.from("obligation_payments").select("obligation_id").eq("transaction_id", paymentId),
    ]);
    const already = new Set((linked ?? []).map((l) => l.obligation_id as string));
    setObls(((bal ?? []) as Obl[]).filter((o) => !already.has(o.id)));
    setLoading(false);
  }

  function close() {
    setOpen(false);
    setSelected(null);
    if (dirty) router.refresh(); // синхронизируем страницу только если что-то разнесли
  }

  // Максимум, который можно разнести на выбранное обязательство: не больше остатка
  // выплаты и не больше долга обязательства (переплату не допускаем).
  function maxFor(o: Obl): number {
    return Math.min(remaining, o.outstanding);
  }

  function pick(o: Obl) {
    setSelected(o);
    setAmountStr((maxFor(o) / 100).toFixed(2).replace(".", ","));
  }

  async function allocate() {
    if (!selected) return;
    const amount = parseMoney(amountStr);
    const max = maxFor(selected);
    if (amount <= 0) return toast.error("Введите сумму больше нуля");
    if (amount > max) return toast.error(`Не больше ${formatMoney(max, baseCurrency)} (остаток выплаты / долг обязательства)`);

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("obligation_payments").insert({
      obligation_id: selected.id,
      amount,
      paid_on: occurredOn,
      transaction_id: paymentId,
      created_by: userId,
    });
    setBusy(false);
    if (error) return void toast.error(error.message);

    toast.success(`Разнесено ${formatMoney(amount, baseCurrency)}`);
    const newRemaining = remaining - amount;
    setDirty(true);
    // Если долг закрыт полностью — убираем обязательство из списка; иначе уменьшаем его.
    setObls((list) =>
      amount >= selected.outstanding
        ? list.filter((o) => o.id !== selected.id)
        : list.map((o) => (o.id === selected.id ? { ...o, outstanding: o.outstanding - amount } : o)),
    );
    setRemaining(newRemaining);
    setSelected(null);
    // Выплата разнесена полностью — закрываем и обновляем страницу.
    if (newRemaining <= 0) close();
  }

  if (remainingBase <= 0) return null;

  if (!open) {
    return (
      <button
        onClick={load}
        className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand/90"
      >
        Разнести
      </button>
    );
  }

  return (
    <div className="relative inline-block text-left">
      <div className="fixed inset-0 z-20" onClick={close} />
      <div className="absolute right-0 z-30 mt-1 max-h-80 w-80 overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-left shadow-xl dark:border-white/10 dark:bg-[#1b1d22]">
        <div className="flex items-center justify-between px-2 py-1.5 text-xs text-slate-400">
          <span>Куда разнести · остаток {formatMoney(remaining, baseCurrency)}</span>
        </div>

        {loading ? (
          <div className="px-2 py-3 text-sm text-slate-400">Загрузка…</div>
        ) : selected ? (
          // Шаг 2 — сумма части.
          <div className="p-2">
            <button onClick={() => setSelected(null)} className="mb-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-neutral-200">← к списку</button>
            <div className="mb-1 truncate text-sm text-slate-600 dark:text-neutral-300">
              {selected.due_date ? formatDate(selected.due_date) : "—"}{selected.note ? ` · ${selected.note}` : ""}
            </div>
            <div className="mb-2 text-xs text-slate-400">Долг {formatMoney(selected.outstanding, selected.currency)} · можно до {formatMoney(maxFor(selected), baseCurrency)}</div>
            <div className="flex items-center gap-2">
              <input
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") allocate(); }}
                inputMode="decimal"
                autoFocus
                className="input py-1.5 text-sm"
                placeholder="0,00"
              />
              <button onClick={() => setAmountStr((maxFor(selected) / 100).toFixed(2).replace(".", ","))} className="shrink-0 rounded-lg px-2 py-1 text-xs text-brand hover:bg-brand/10" title="Разнести всё доступное">Всё</button>
            </div>
            <button
              onClick={allocate}
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
              onClick={() => pick(o)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-white/[0.06]"
            >
              <span className="truncate text-slate-600 dark:text-neutral-300">
                {o.due_date ? formatDate(o.due_date) : "—"}
                {o.note ? ` · ${o.note}` : ""}
              </span>
              <span className="shrink-0 font-medium text-slate-800 dark:text-neutral-100">
                {formatMoney(o.outstanding, o.currency)}
              </span>
            </button>
          ))
        ) : (
          <div className="px-2 py-3 text-sm text-slate-400">
            {dirty ? "Все обязательства этого контрагента закрыты." : "Нет открытых обязательств этого контрагента."}
          </div>
        )}
      </div>
    </div>
  );
}
