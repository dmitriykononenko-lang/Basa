"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";

type Cand = { id: string; occurred_on: string; amount: number; note: string | null };

export default function LinkPaymentButton({
  obligationId, oblType, counterpartyId, currency, outstanding, teamId, userId,
}: {
  obligationId: string;
  oblType: "receivable" | "payable";
  counterpartyId: string | null;
  currency: string;
  outstanding: number;
  teamId: string;
  userId: string;
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
    const [{ data: linked }, { data: txs }] = await Promise.all([
      supabase.from("obligation_payments").select("transaction_id").not("transaction_id", "is", null),
      supabase.from("transactions")
        .select("id, occurred_on, amount, note")
        .eq("team_id", teamId).eq("counterparty_id", counterpartyId).eq("type", txType)
        .eq("currency", currency).eq("status", "actual")
        .order("occurred_on", { ascending: false }).limit(50),
    ]);
    const linkedSet = new Set((linked ?? []).map((l) => l.transaction_id as string));
    setCands(((txs ?? []) as Cand[]).filter((t) => !linkedSet.has(t.id)));
    setLoading(false);
  }

  async function link(t: Cand) {
    setBusy(true);
    const supabase = createClient();
    const amount = Math.min(t.amount, outstanding);
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
      <div className="absolute right-0 z-30 mt-1 max-h-72 w-72 overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-left shadow-xl dark:border-white/10 dark:bg-[#1b1d22]">
        <div className="px-2 py-1.5 text-xs text-slate-400">Существующая {txType === "expense" ? "выплата" : "оплата"} этому контрагенту</div>
        {loading ? (
          <div className="px-2 py-3 text-sm text-slate-400">Загрузка…</div>
        ) : cands.length > 0 ? (
          cands.map((t) => (
            <button key={t.id} onClick={() => link(t)} disabled={busy}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-white/[0.06]">
              <span className="truncate text-slate-600 dark:text-neutral-300">
                {formatDate(t.occurred_on)}{t.note ? ` · ${t.note}` : ""}
              </span>
              <span className="shrink-0 font-medium text-slate-800 dark:text-neutral-100">{formatMoney(t.amount, currency)}</span>
            </button>
          ))
        ) : (
          <div className="px-2 py-3 text-sm text-slate-400">Нет подходящих операций (тип, валюта, контрагент, не привязаны).</div>
        )}
      </div>
    </div>
  );
}
