"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import { toast } from "@/lib/toast";

export type NextPayment = { id: string; title: string; amount: number; currency: string; date: string };

// Карточка ближайшего планового платежа в сайдбаре: «Подтвердить оплату» проводит его.
export default function NextPaymentCard({ payment }: { payment: NextPayment }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(payment.date + "T00:00:00");
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const rel = diff < 0 ? "просрочен" : diff === 0 ? "сегодня" : diff === 1 ? "завтра" : null;
  const dm = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  const overdue = diff <= 0;

  async function confirm() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("transactions")
      .update({ status: "actual", occurred_on: new Date().toISOString().slice(0, 10) })
      .eq("id", payment.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Платёж проведён");
    router.refresh();
  }

  return (
    <div className="rounded-2xl bg-white p-3.5 ring-1 ring-slate-200/70 dark:bg-white/[0.03] dark:ring-white/[0.06]">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span className={`h-1.5 w-1.5 rounded-full ${overdue ? "bg-red-500" : "bg-amber-500"}`} />
        Ближайший платёж
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-800 dark:text-neutral-100" title={payment.title}>
            {payment.title}
          </div>
          <div className={`text-[11px] ${overdue ? "text-red-500" : "text-slate-400 dark:text-neutral-500"}`}>
            {rel ? `${rel} · ${dm}` : dm}
          </div>
        </div>
        <div className="shrink-0 text-sm font-bold tabular-nums text-slate-900 dark:text-white">
          {formatMoney(payment.amount, payment.currency)}
        </div>
      </div>
      <button
        onClick={confirm}
        disabled={busy}
        className="mt-2.5 w-full rounded-xl bg-neutral-900 py-2 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {busy ? "…" : "Подтвердить оплату"}
      </button>
    </div>
  );
}
