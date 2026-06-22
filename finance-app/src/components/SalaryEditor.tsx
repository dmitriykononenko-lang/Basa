"use client";

import { useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney, formatMoney, formatDate } from "@/lib/format";
import { CURRENCIES } from "@/lib/constants";

export type SalaryRow = { id: string; effective_from: string; amount: number; currency: string };
export type PositionRow = { id: string; effective_from: string; position: string };

export default function SalaryEditor({
  teamId, userId, counterpartyId, defaultCurrency, salaries, positions, endDate, department, autoAccrue = false,
}: {
  teamId: string;
  userId: string;
  counterpartyId: string;
  defaultCurrency: string;
  salaries: SalaryRow[];
  positions: PositionRow[];
  endDate: string | null;
  department: string | null;
  autoAccrue?: boolean;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dept, setDept] = useState(department ?? "");
  const [posTitle, setPosTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [end, setEnd] = useState(endDate ?? "");
  const [auto, setAuto] = useState(autoAccrue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Единая история: мёржим оклад и должность по дате «действует с»
  const history = useMemo(() => {
    const map = new Map<string, { date: string; salary?: SalaryRow; position?: PositionRow }>();
    for (const s of salaries) {
      const e = map.get(s.effective_from) ?? { date: s.effective_from };
      e.salary = s; map.set(s.effective_from, e);
    }
    for (const p of positions) {
      const e = map.get(p.effective_from) ?? { date: p.effective_from };
      e.position = p; map.set(p.effective_from, e);
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [salaries, positions]);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const minor = amount.trim() ? parseMoney(amount) : 0;
    const hasPos = posTitle.trim().length > 0;
    const deptChanged = (dept.trim() || null) !== (department ?? null);
    if (!hasPos && minor <= 0 && !deptChanged) {
      return setError("Заполните отдел, должность или оклад");
    }
    setBusy(true);
    const supabase = createClient();

    // отдел — текущее значение карточки
    if (deptChanged) {
      const { error: de } = await supabase.from("counterparties").update({ department: dept.trim() || null }).eq("id", counterpartyId);
      if (de) { setBusy(false); return setError(de.message); }
    }
    if (hasPos) {
      const { error: pe } = await supabase.from("employee_positions").insert({
        team_id: teamId, counterparty_id: counterpartyId, effective_from: from, position: posTitle.trim(), created_by: userId,
      });
      if (pe) { setBusy(false); return setError(pe.message); }
    }
    if (minor > 0) {
      const { error: se } = await supabase.from("employee_salaries").insert({
        team_id: teamId, counterparty_id: counterpartyId, effective_from: from, amount: minor, currency, created_by: userId,
      });
      if (se) { setBusy(false); return setError(se.message); }
    }
    setBusy(false);
    setPosTitle("");
    setAmount("");
    router.refresh();
  }

  async function removeEntry(row: { salary?: SalaryRow; position?: PositionRow }) {
    if (!confirm("Удалить эту запись (должность и оклад на эту дату)?")) return;
    const supabase = createClient();
    if (row.salary) await supabase.from("employee_salaries").delete().eq("id", row.salary.id);
    if (row.position) await supabase.from("employee_positions").delete().eq("id", row.position.id);
    router.refresh();
  }

  async function saveMeta() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("counterparties")
      .update({ end_date: end || null, auto_accrue: auto })
      .eq("id", counterpartyId);
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.refresh();
  }

  return (
    <section className="rounded-3xl bg-white p-6 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
        Отдел, должность и оклад
      </h2>

      {/* Единая строка добавления */}
      <form onSubmit={addEntry} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Действует с</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input w-40 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Отдел</label>
          <input value={dept} onChange={(e) => setDept(e.target.value)} placeholder="Маркетинг" className="input w-40 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Должность</label>
          <input value={posTitle} onChange={(e) => setPosTitle(e.target.value)} placeholder="Senior-дизайнер" className="input w-48 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Оклад / мес</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" className="input w-32 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Валюта</label>
          <Select className="w-24" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </div>
        <button type="submit" disabled={busy} className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Добавить</button>
      </form>
      <p className="mt-1.5 text-[11px] text-slate-400 dark:text-neutral-500">
        Заполните, что изменилось. Отдел — текущее значение карточки; должность и оклад добавляются в историю «с даты».
      </p>

      {/* Единая история */}
      <div className="mt-4 mb-2 text-xs font-medium text-slate-600 dark:text-neutral-300">История (действует с даты)</div>
      {history.length > 0 ? (
        <div className="overflow-hidden rounded-2xl ring-1 ring-slate-100 dark:ring-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-400 dark:bg-white/[0.03] dark:text-neutral-500">
                <th className="px-3 py-2 font-medium">Действует с</th>
                <th className="px-3 py-2 font-medium">Должность</th>
                <th className="px-3 py-2 text-right font-medium">Оклад</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.date} className="border-t border-slate-50 dark:border-white/[0.04]">
                  <td className="px-3 py-2 text-slate-600 dark:text-neutral-300">с {formatDate(r.date)}</td>
                  <td className="px-3 py-2 text-slate-800 dark:text-neutral-100">{r.position?.position ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-800 dark:text-neutral-100">
                    {r.salary ? formatMoney(r.salary.amount, r.salary.currency) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => removeEntry(r)} className="text-xs text-slate-400 hover:text-red-500" title="Удалить">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Пока нет записей. Добавьте отдел/должность/оклад выше.</p>
      )}

      {/* Трудоустройство */}
      <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4 dark:border-white/[0.06]">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Дата увольнения</label>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input w-40 py-1.5 text-sm" />
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-600 dark:text-neutral-300" title="Каждый месяц автоматически начислять оклад по ставке">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
          Авто-начисление каждый месяц
        </label>
        <button onClick={saveMeta} disabled={busy} className="rounded-full bg-slate-200 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:bg-neutral-700">
          Сохранить
        </button>
      </div>

      {error && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
    </section>
  );
}
