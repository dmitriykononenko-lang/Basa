"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney } from "@/lib/format";
import { CURRENCIES } from "@/lib/constants";

export default function AddAccrualForm({
  teamId,
  employeeId,
  defaultCurrency,
  projects = [],
}: {
  teamId: string;
  employeeId: string;
  defaultCurrency: string;
  projects?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  );
  const [kind, setKind] = useState<"fixed" | "variable">("fixed");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Введите сумму больше нуля");
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("payroll_accruals").insert({
      team_id: teamId,
      employee_id: employeeId,
      period_month: `${month}-01`,
      kind,
      amount: minor,
      currency,
      project_id: projectId || null,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setAmount("");
    setProjectId("");
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        + Начислить
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Месяц</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Часть</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as "fixed" | "variable")} className="input">
          <option value="fixed">Фиксированная</option>
          <option value="variable">Переменная</option>
        </select>
      </div>
      {projects.length > 0 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
            Проект {kind === "variable" ? "(за что)" : ""}
          </label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input">
            <option value="">— без проекта —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Сумма</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" className="input w-32" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Валюта</label>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input">
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">{loading ? "…" : "Сохранить"}</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
      </div>
      {error && <p className="w-full rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
    </form>
  );
}
