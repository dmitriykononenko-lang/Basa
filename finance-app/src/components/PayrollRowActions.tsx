"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

type Account = { id: string; name: string; currency: string };
type Obl = { id: string; outstanding: number; currency: string; due_date: string | null };

// Действия по сотруднику на странице зарплаты: выплатить или запланировать все непогашенные начисления.
export default function PayrollRowActions({
  teamId,
  userId,
  counterpartyId,
  obligations,
  accounts,
  scheduledOblIds,
}: {
  teamId: string;
  userId: string;
  counterpartyId: string;
  obligations: Obl[];
  accounts: Account[];
  scheduledOblIds: string[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<null | "pay" | "plan">(null);

  const due = obligations.filter((o) => o.outstanding > 0);
  if (due.length === 0) return <span className="text-xs text-slate-400">—</span>;

  const today = new Date().toISOString().slice(0, 10);
  const scheduled = new Set(scheduledOblIds);

  async function payAll() {
    if (!confirm(`Выплатить все начисления (${due.length})? Будут созданы расходы по счетам в соответствующей валюте.`)) return;
    setLoading("pay");
    const supabase = createClient();
    // Одна транзакция БД на выплату: операция и её разнесение на начисление
    // создаются вместе. Раньше это были два независимых insert'а — при сбое
    // второго деньги списаны, а начисление осталось открытым. Ключ
    // идемпотентности (id начисления) делает повторный прогон безопасным.
    for (const o of due) {
      const acc = accounts.find((a) => a.currency === o.currency);
      const { error: payErr } = await supabase.rpc("obligation_pay", {
        p_obligation: o.id,
        p_account: acc?.id ?? null,
        p_amount: o.outstanding,
        p_occurred_on: today,
        p_note: "Выплата ЗП",
        p_request_id: o.id,
      });
      if (payErr) { setLoading(null); toast.error(payErr.message); return; }
    }
    setLoading(null);
    toast.success("Выплачено");
    router.refresh();
  }

  async function planAll() {
    const toPlan = due.filter((o) => !scheduled.has(o.id));
    if (toPlan.length === 0) { toast.info("Уже запланировано"); return; }
    setLoading("plan");
    const supabase = createClient();
    const payload = toPlan.map((o) => ({
      team_id: teamId, type: "expense" as const, amount: o.outstanding, currency: o.currency,
      counterparty_id: counterpartyId, occurred_on: o.due_date ?? today,
      status: "planned" as const, obligation_id: o.id, created_by: userId,
    }));
    // Плановые платежи создаются по одному через transaction_insert с ключом
    // идемпотентности: повторное нажатие «Запланировать» не создаёт дублей
    // (в БД это дополнительно закрыто индексом transactions_obl_planned_uniq).
    for (const row of payload) {
      const { error } = await supabase.rpc("transaction_insert", {
        p_payload: row, p_request_id: row.obligation_id,
      });
      if (error) { setLoading(null); toast.error(error.message); return; }
    }
    setLoading(null);
    toast.success(`Запланировано: ${payload.length}`);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={planAll}
        disabled={loading !== null}
        className="rounded-full px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {loading === "plan" ? "…" : "Запланировать"}
      </button>
      <button
        onClick={payAll}
        disabled={loading !== null}
        className="rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {loading === "pay" ? "…" : "Выплатить"}
      </button>
    </div>
  );
}
