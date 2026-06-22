"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney } from "@/lib/format";
import { CURRENCIES } from "@/lib/constants";
import Combobox from "@/components/Combobox";
import { addBusinessDays } from "@/lib/workdays";
import DeleteProjectButton from "@/components/DeleteProjectButton";

const STATUSES: { value: string; label: string }[] = [
  { value: "active", label: "Активный" },
  { value: "done", label: "Сдан" },
  { value: "archived", label: "В архиве" },
];

export default function EditProjectForm({
  projectId,
  name: initialName,
  status: initialStatus,
  responsibleId,
  employees,
  startDate: initialStart,
  planWorkDays,
  dueDate: initialDue,
  completedOn,
  bonusAmount,
  bonusCurrency,
}: {
  projectId: string;
  name: string;
  status: string;
  responsibleId: string | null;
  employees: { id: string; name: string }[];
  startDate: string;
  planWorkDays: number | null;
  dueDate: string | null;
  completedOn: string | null;
  bonusAmount: number;
  bonusCurrency: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState(initialStatus);
  const [responsible, setResponsible] = useState(responsibleId ?? "");
  const [startDate, setStartDate] = useState(initialStart ?? today);
  const [mode, setMode] = useState<"days" | "date">(planWorkDays != null ? "days" : initialDue ? "date" : "days");
  const [planDays, setPlanDays] = useState(planWorkDays != null ? String(planWorkDays) : "");
  const [dueDate, setDueDate] = useState(initialDue ?? "");
  const [completed, setCompleted] = useState(completedOn ?? "");
  const [bonus, setBonus] = useState(bonusAmount ? (bonusAmount / 100).toFixed(2).replace(".", ",") : "");
  const [bonusCur, setBonusCur] = useState(bonusCurrency || "RUB");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planNum = planDays.trim() ? Math.max(0, parseInt(planDays, 10) || 0) : null;
  const computedDue = mode === "days" && planNum ? addBusinessDays(startDate, planNum) : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("projects")
      .update({
        name: name.trim(),
        status,
        responsible_counterparty_id: responsible || null,
        start_date: startDate,
        plan_work_days: mode === "days" ? planNum : null,
        due_date: mode === "date" ? dueDate || null : null,
        completed_on: status === "done" ? completed || null : null,
        bonus_amount: bonus.trim() ? parseMoney(bonus) : 0,
        bonus_currency: bonusCur,
      })
      .eq("id", projectId);
    if (error) { setError(error.message); setLoading(false); return; }
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-ghost">Редактировать</button>;
  }

  return (
    <form onSubmit={save} className="w-full space-y-3 rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Название</label>
        <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Статус</label>
          <Select value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s.value, label: s.label }))} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Ответственный (аналитик)</label>
          <Combobox value={responsible} onChange={setResponsible}
            options={employees.map((e) => ({ value: e.id, label: e.name }))}
            placeholder="— не назначен —" emptyLabel="— не назначен —" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Дата старта</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input w-full" />
        </div>
        {status === "done" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Дата сдачи</label>
            <input type="date" value={completed} onChange={(e) => setCompleted(e.target.value)} placeholder="сегодня" className="input w-full" />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Срок сдачи</label>
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-auto" value={mode} onChange={(v) => setMode(v as "days" | "date")} options={[{ value: "days", label: "Рабочих дней" }, { value: "date", label: "Дата" }]} />
            {mode === "days" ? (
              <input type="number" min={0} value={planDays} onChange={(e) => setPlanDays(e.target.value)} placeholder="напр. 20" className="input w-28" />
            ) : (
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input w-44" />
            )}
            {computedDue && <span className="text-xs text-slate-400">→ срок {new Date(computedDue).toLocaleDateString("ru-RU")}</span>}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Бонус аналитику за сдачу</label>
          <div className="flex gap-2">
            <input value={bonus} onChange={(e) => setBonus(e.target.value)} inputMode="decimal" placeholder="0,00" className="input w-40" />
            <Select className="w-24" value={bonusCur} onChange={setBonusCur} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </div>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 dark:text-neutral-600">
        При статусе «Сдан» аналитику автоматически начисляется бонус за сдачу (с учётом просрочки по ступеням мотивации).
      </p>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={loading} className="btn-primary">{loading ? "…" : "Сохранить"}</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
        <span className="ml-auto"><DeleteProjectButton id={projectId} name={name} /></span>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
    </form>
  );
}
