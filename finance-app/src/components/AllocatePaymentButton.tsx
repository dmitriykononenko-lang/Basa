"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";

type Obl = { id: string; outstanding: number; currency: string; due_date: string | null; note: string | null };

// Разнесение конкретной выплаты по открытым обязательствам контрагента.
// Одну операцию можно привязать к нескольким обязательствам (см. миграцию 0072).
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

  async function load() {
    setOpen(true);
    setLoading(true);
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

  async function allocate(o: Obl) {
    setBusy(true);
    const supabase = createClient();
    // Остаток выплаты в базовой валюте; обязательство обычно в базовой валюте команды.
    const amount = Math.min(remainingBase, o.outstanding);
    const { error } = await supabase.from("obligation_payments").insert({
      obligation_id: o.id,
      amount,
      paid_on: occurredOn,
      transaction_id: paymentId,
      created_by: userId,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOpen(false);
    toast.success("Выплата привязана к обязательству");
    router.refresh();
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
      <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
      <div className="absolute right-0 z-30 mt-1 max-h-72 w-80 overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-left shadow-xl dark:border-white/10 dark:bg-[#1b1d22]">
        <div className="px-2 py-1.5 text-xs text-slate-400">
          Куда разнести · остаток {formatMoney(remainingBase, baseCurrency)}
        </div>
        {loading ? (
          <div className="px-2 py-3 text-sm text-slate-400">Загрузка…</div>
        ) : obls.length > 0 ? (
          obls.map((o) => (
            <button
              key={o.id}
              onClick={() => allocate(o)}
              disabled={busy}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-white/[0.06]"
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
          <div className="px-2 py-3 text-sm text-slate-400">Нет открытых обязательств этого контрагента.</div>
        )}
      </div>
    </div>
  );
}
