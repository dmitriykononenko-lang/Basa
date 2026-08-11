"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import { toBase, type RateMap } from "@/lib/fx";
import { toast } from "@/lib/toast";

type Cand = {
  id: string;
  occurred_on: string;
  amount: number;
  currency: string;
  note: string | null;
  remainingBase: number; // непривязанный остаток в базовой валюте
};

export default function LinkPaymentButton({
  obligationId, oblType, counterpartyId, currency, outstanding, teamId, userId,
  rates, baseCurrency,
}: {
  obligationId: string;
  oblType: "receivable" | "payable";
  counterpartyId: string | null;
  currency: string;
  outstanding: number;
  teamId: string;
  userId: string;
  rates: RateMap;
  baseCurrency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cands, setCands] = useState<Cand[]>([]);
  const [busy, setBusy] = useState(false);

  if (outstanding <= 0 || !counterpartyId) return null;
  const txType = oblType === "payable" ? "expense" : "income";

  async function load() {
    setOpen(true); setLoading(true);
    const supabase = createClient();
    // Операции этому контрагенту нужного типа (любой валюты — считаем остаток в базовой)
    const { data: txs } = await supabase.from("transactions")
      .select("id, occurred_on, amount, currency, note")
      .eq("team_id", teamId).eq("counterparty_id", counterpartyId).eq("type", txType)
      .eq("status", "actual")
      .order("occurred_on", { ascending: false }).limit(100);
    const list = (txs ?? []) as { id: string; occurred_on: string; amount: number; currency: string; note: string | null }[];
    const ids = list.map((t) => t.id);
    const alloc = new Map<string, number>();
    if (ids.length) {
      const { data: pays } = await supabase.from("obligation_payments").select("transaction_id, amount").in("transaction_id", ids);
      for (const p of (pays ?? []) as { transaction_id: string | null; amount: number }[]) {
        if (p.transaction_id) alloc.set(p.transaction_id, (alloc.get(p.transaction_id) ?? 0) + p.amount);
      }
    }
    const out = list
      .map((t) => ({ ...t, remainingBase: toBase(t.amount, t.currency, rates) - (alloc.get(t.id) ?? 0) }))
      .filter((c) => c.remainingBase > 0);
    setCands(out);
    setLoading(false);
  }

  async function link(t: Cand) {
    setBusy(true);
    const supabase = createClient();
    // Обязательство обычно в базовой валюте команды; остаток выплаты уже в базовой.
    const amount = Math.min(t.remainingBase, outstanding);
    const { error } = await supabase.from("obligation_payments").insert({
      obligation_id: obligationId, amount, paid_on: t.occurred_on, transaction_id: t.id, created_by: userId,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setOpen(false);
    toast.success("Операция привязана к обязательству");
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={load} className="rounded-full px-3 py-1 text-xs font-medium text-brand transition hover:bg-brand/5">
        Привязать
      </button>
    );
  }

  return (
    <div className="relative inline-block text-left">
      <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
      <div className="absolute right-0 z-30 mt-1 max-h-72 w-80 overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-left shadow-xl dark:border-white/10 dark:bg-[#1b1d22]">
        <div className="px-2 py-1.5 text-xs text-slate-400">{txType === "expense" ? "Выплата" : "Оплата"} этому контрагенту (непривязанный остаток)</div>
        {loading ? (
          <div className="px-2 py-3 text-sm text-slate-400">Загрузка…</div>
        ) : cands.length > 0 ? (
          cands.map((t) => (
            <button key={t.id} onClick={() => link(t)} disabled={busy}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-white/[0.06]">
              <span className="truncate text-slate-600 dark:text-neutral-300">
                {formatDate(t.occurred_on)}{t.note ? ` · ${t.note}` : ""}
                {t.currency !== baseCurrency && <span className="text-slate-400"> · {formatMoney(t.amount, t.currency)}</span>}
              </span>
              <span className="shrink-0 font-medium text-slate-800 dark:text-neutral-100">{formatMoney(t.remainingBase, baseCurrency)}</span>
            </button>
          ))
        ) : (
          <div className="px-2 py-3 text-sm text-slate-400">Нет операций с непривязанным остатком.</div>
        )}
      </div>
    </div>
  );
}
