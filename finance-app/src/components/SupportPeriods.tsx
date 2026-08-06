"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Select } from "@/components/ui/select";
import { parseMoney } from "@/lib/format";

export type PeriodRow = {
  id: string;
  month: string;
  monthLabel: string;  // «27.07–26.08.2026»
  revenue: string | null;
  costs: string | null;
  profit: string | null;
  margin: string | null;
  bonus: string;
  payment: string | null; // «300 USDT · 27.07.2026» — привязанная оплата
};

type AccountOpt = { id: string; name: string; currency: string };
type PayCandidate = { id: string; label: string };

export default function SupportPeriods({
  projectId,
  periods,
  nextCycleLabel,
  bonusPerMonth,
  canManage,
  showFinance,
  accounts,
  payCandidates,
}: {
  projectId: string;
  periods: PeriodRow[];
  nextCycleLabel: string;
  bonusPerMonth: string;
  canManage: boolean;
  showFinance: boolean;
  accounts: AccountOpt[];
  payCandidates: PayCandidate[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState(false);
  // pay: "none" | "new" | <id операции>
  const [pay, setPay] = useState<string>(payCandidates[0]?.id ?? "none");
  const [prepay, setPrepay] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");

  const accCur = accounts.find((a) => a.id === accountId)?.currency ?? "";

  async function renew() {
    setBusy(true);
    setError(null);
    const args: Record<string, unknown> = { p_project: projectId };
    if (pay === "new") {
      args.p_prepay_amount = prepay.trim() ? parseMoney(prepay) : 0;
      args.p_account = accountId || null;
    } else if (pay !== "none") {
      args.p_income_tx = pay;
    }
    const { error } = await supabase.rpc("support_open_period", args);
    setBusy(false);
    if (error) { setError(error.message); return; }
    setOpenForm(false);
    setPrepay("");
    router.refresh();
  }

  async function endSupport() {
    if (!confirm("Завершить поддержку? Прошлые циклы и оплаты останутся, новые перестанут создаваться.")) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("projects").update({ status: "done", completed_on: new Date().toISOString().slice(0, 10) }).eq("id", projectId);
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.refresh();
  }

  async function removePeriod(id: string) {
    if (!confirm("Убрать этот цикл? Неоплаченный бонус аналитику удалится. Новая предоплата, созданная при продлении, тоже удалится (привязанная существующая операция — останется).")) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("support_delete_period", { p_period: id });
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.refresh();
  }

  const payOptions = [
    { value: "none", label: "— пока без оплаты —" },
    ...payCandidates.map((c) => ({ value: c.id, label: c.label })),
    { value: "new", label: "＋ Занести новую предоплату" },
  ];

  return (
    <section className="mt-6 rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          Помесячная поддержка
        </h2>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => setOpenForm((v) => !v)}>
              Продлить: {nextCycleLabel}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={endSupport}>
              Завершить
            </button>
          </div>
        )}
      </div>

      {canManage && openForm && (
        <div className="mb-4 rounded-2xl bg-slate-50 p-4 dark:bg-white/[0.03]">
          <div className="mb-2 text-sm font-medium text-slate-700 dark:text-neutral-200">
            Открыть цикл <b>{nextCycleLabel}</b>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Оплата за цикл</label>
              <Select value={pay} onChange={setPay} options={payOptions} />
            </div>
            {pay === "new" && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Сумма предоплаты</label>
                  <div className="flex items-center gap-2">
                    <input value={prepay} onChange={(e) => setPrepay(e.target.value)} inputMode="decimal" placeholder="0,00" className="input w-32" />
                    <span className="text-sm text-slate-400">{accCur}</span>
                  </div>
                </div>
                <div className="min-w-[170px]">
                  <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Счёт зачисления</label>
                  <Select value={accountId} onChange={setAccountId}
                    options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))} />
                </div>
              </>
            )}
            <button type="button" className="btn-primary" disabled={busy} onClick={renew}>
              {busy ? "…" : "Открыть цикл"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400 dark:text-neutral-600">
            {pay === "new"
              ? "Создастся приход-предоплата на начало цикла."
              : pay === "none"
                ? "Цикл откроется без оплаты (только бонус аналитику). Оплату можно привязать позже."
                : "Выбранный приход привяжется к этому циклу — без дубля выручки."}
            {" "}Аналитику начислится бонус за ведение ({bonusPerMonth}) с выплатой в конце цикла.
          </p>
        </div>
      )}

      {periods.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Пока нет ни одного цикла. Нажмите «Продлить: {nextCycleLabel}», чтобы открыть первый оплачиваемый цикл.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="py-2 pr-4 font-medium">Цикл</th>
                <th className="py-2 pr-4 font-medium">Оплата</th>
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
                  <td className="py-2.5 pr-4">
                    {p.payment
                      ? <span className="text-slate-600 dark:text-neutral-300">{p.payment}</span>
                      : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">нет оплаты</span>}
                  </td>
                  {showFinance && <td className="py-2.5 pr-4 text-right text-emerald-600 dark:text-emerald-400">{p.revenue ?? "—"}</td>}
                  {showFinance && <td className="py-2.5 pr-4 text-right text-red-600 dark:text-red-400">{p.costs ?? "—"}</td>}
                  {showFinance && <td className="py-2.5 pr-4 text-right text-slate-800 dark:text-neutral-200">{p.profit ?? "—"}</td>}
                  {showFinance && <td className="py-2.5 pr-4 text-right text-slate-500 dark:text-neutral-400">{p.margin ?? "—"}</td>}
                  <td className="py-2.5 pr-4 text-right font-medium text-brand">{p.bonus}</td>
                  {canManage && (
                    <td className="py-2.5 text-right">
                      <button type="button" onClick={() => removePeriod(p.id)} disabled={busy} className="text-xs text-slate-400 hover:text-red-500" title="Убрать цикл">✕</button>
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
        Цикл считается от даты старта. Если клиент уже оплатил — привяжите существующий приход (без дубля); если оплаты ещё нет —
        занесите предоплату. В «Затраты» цикла бонус аналитику уже включён — маржа честная.
      </p>
    </section>
  );
}
