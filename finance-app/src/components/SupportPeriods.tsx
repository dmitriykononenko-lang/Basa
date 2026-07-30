"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type PeriodRow = {
  id: string;
  month: string;       // ISO first-of-month
  monthLabel: string;  // «Июль 2026»
  revenue: string | null;
  costs: string | null;
  profit: string | null;
  margin: string | null;
  bonus: string;       // отформатированный бонус аналитику
};

export default function SupportPeriods({
  projectId,
  periods,
  nextMonth,
  nextMonthLabel,
  bonusPerMonth,
  canManage,
  showFinance,
}: {
  projectId: string;
  periods: PeriodRow[];
  nextMonth: string;
  nextMonthLabel: string;
  bonusPerMonth: string;
  canManage: boolean;
  showFinance: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function renew() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("support_open_period", { p_project: projectId, p_month: nextMonth });
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.refresh();
  }

  async function endSupport() {
    if (!confirm("Завершить поддержку? Начисления за уже проведённые месяцы останутся, новые перестанут создаваться.")) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("projects").update({ status: "done", completed_on: new Date().toISOString().slice(0, 10) }).eq("id", projectId);
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.refresh();
  }

  async function removePeriod(id: string) {
    if (!confirm("Убрать этот месяц и связанное начисление аналитику (если ещё не оплачено)?")) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("support_delete_period", { p_period: id });
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.refresh();
  }

  return (
    <section className="mt-6 rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          Помесячная поддержка
        </h2>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={renew}>
              {busy ? "…" : `Продлить на ${nextMonthLabel}`}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={endSupport}>
              Завершить
            </button>
          </div>
        )}
      </div>

      {periods.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Пока нет ни одного месяца. Нажмите «Продлить на {nextMonthLabel}», чтобы открыть первый оплачиваемый месяц —
          аналитику начислится бонус за ведение ({bonusPerMonth}).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="py-2 pr-4 font-medium">Месяц</th>
                {showFinance && <th className="py-2 pr-4 text-right font-medium">Выручка</th>}
                {showFinance && <th className="py-2 pr-4 text-right font-medium">Затраты</th>}
                {showFinance && <th className="py-2 pr-4 text-right font-medium">Прибыль</th>}
                {showFinance && <th className="py-2 pr-4 text-right font-medium">Маржа</th>}
                <th className="py-2 pr-4 text-right font-medium">Бонус аналитику</th>
                {canManage && <th className="py-2 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                  <td className="py-2.5 pr-4 font-medium text-slate-800 dark:text-neutral-200">{p.monthLabel}</td>
                  {showFinance && <td className="py-2.5 pr-4 text-right text-emerald-600 dark:text-emerald-400">{p.revenue ?? "—"}</td>}
                  {showFinance && <td className="py-2.5 pr-4 text-right text-red-600 dark:text-red-400">{p.costs ?? "—"}</td>}
                  {showFinance && <td className="py-2.5 pr-4 text-right text-slate-800 dark:text-neutral-200">{p.profit ?? "—"}</td>}
                  {showFinance && <td className="py-2.5 pr-4 text-right text-slate-500 dark:text-neutral-400">{p.margin ?? "—"}</td>}
                  <td className="py-2.5 pr-4 text-right font-medium text-brand">{p.bonus}</td>
                  {canManage && (
                    <td className="py-2.5 text-right">
                      <button type="button" onClick={() => removePeriod(p.id)} disabled={busy} className="text-xs text-slate-400 hover:text-red-500" title="Убрать месяц">✕</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
      <p className="mt-3 text-[11px] text-slate-400 dark:text-neutral-600">
        Каждый продлённый месяц начисляет аналитику фиксированный бонус за ведение ({bonusPerMonth}) — он попадает
        к нему в «Начисления». Клиент не продлил — нажмите «Завершить».
      </p>
    </section>
  );
}
