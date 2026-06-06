"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatMoney, formatDate } from "@/lib/format";
import { CURRENCIES } from "@/lib/constants";

export type SalaryRow = { id: string; effective_from: string; amount: number; currency: string };

export default function SalaryEditor({
  teamId, userId, counterpartyId, defaultCurrency, salaries, endDate, department,
}: {
  teamId: string;
  userId: string;
  counterpartyId: string;
  defaultCurrency: string;
  salaries: SalaryRow[];
  endDate: string | null;
  department: string | null;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [end, setEnd] = useState(endDate ?? "");
  const [dept, setDept] = useState(department ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addSalary(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Введите оклад больше нуля");
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("employee_salaries").insert({
      team_id: teamId, counterparty_id: counterpartyId, effective_from: from,
      amount: minor, currency, created_by: userId,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setAmount("");
    router.refresh();
  }

  async function removeSalary(id: string) {
    if (!confirm("Удалить эту ставку оклада?")) return;
    const supabase = createClient();
    await supabase.from("employee_salaries").delete().eq("id", id);
    router.refresh();
  }

  async function saveMeta() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("counterparties")
      .update({ end_date: end || null, department: dept || null })
      .eq("id", counterpartyId);
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.refresh();
  }

  return (
    <section className="rounded-3xl bg-white p-6 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
        Оклад, отдел и трудоустройство
      </h2>

      {/* Отдел и дата увольнения */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Отдел</label>
          <input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="Например, Маркетинг" className="input w-44 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Дата увольнения</label>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input w-40 py-1.5 text-sm" />
        </div>
        <button onClick={saveMeta} disabled={busy} className="rounded-full bg-slate-200 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:bg-neutral-700">
          Сохранить
        </button>
      </div>

      {/* История оклада */}
      <div className="mb-3 text-xs font-medium text-slate-600 dark:text-neutral-300">История оклада (ставка действует с даты)</div>
      {salaries.length > 0 ? (
        <ul className="mb-3 space-y-1.5 text-sm">
          {salaries.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
              <span className="text-slate-600 dark:text-neutral-300">с {formatDate(s.effective_from)}</span>
              <span className="flex items-center gap-3">
                <b className="text-slate-800 dark:text-neutral-100">{formatMoney(s.amount, s.currency)}</b>
                <button onClick={() => removeSalary(s.id)} className="text-xs text-slate-400 hover:text-red-500" title="Удалить">✕</button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-slate-400">Оклад не задан. Добавьте ставку — она будет подставляться при начислении.</p>
      )}

      <form onSubmit={addSalary} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Действует с</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input w-40 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Оклад / мес</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" className="input w-32 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Валюта</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input w-24 py-1.5 text-sm">
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button type="submit" disabled={busy} className="rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Добавить ставку</button>
      </form>

      {error && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
    </section>
  );
}
