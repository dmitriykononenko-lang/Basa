"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMoney } from "@/lib/format";
import { CURRENCIES } from "@/lib/constants";
import { salaryForMonth, type SalaryRate as Salary } from "@/lib/salary";

export default function AddAccrualForm({
  teamId,
  employeeId,
  defaultCurrency,
  projects = [],
  salaries = [],
  categories = [],
}: {
  teamId: string;
  employeeId: string;
  defaultCurrency: string;
  projects?: { id: string; name: string }[];
  salaries?: Salary[];
  categories?: { id: string; name: string; kind: string }[];
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
  const [categoryId, setCategoryId] = useState("");
  const [projectId, setProjectId] = useState("");
  const expenseCats = categories.filter((c) => c.kind === "expense");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Подстановка оклада: при открытии и смене месяца, если часть фиксированная
  const subst = kind === "fixed" ? salaryForMonth(salaries, `${month}-01`) : null;
  function applySalary() {
    if (subst) {
      setAmount((subst.amount / 100).toFixed(2).replace(".", ","));
      setCurrency(subst.currency);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const minor = parseMoney(amount);
    if (minor <= 0) return setError("Введите сумму больше нуля");
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("obligations").insert({
      team_id: teamId,
      counterparty_id: employeeId,
      type: "payable",
      amount: minor,
      currency,
      category_id: categoryId || null,
      project_id: projectId || null,
      due_date: `${month}-01`,
      period_month: `${month}-01`,
      pay_part: kind,
      status: "open",
      note: "Начисление ЗП",
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
      <button onClick={() => { setOpen(true); applySalary(); }} className="btn-primary">
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
        <Select value={kind} onChange={(v) => setKind(v as "fixed" | "variable")} options={[{ value: "fixed", label: "Фиксированная" }, { value: "variable", label: "Переменная" }]} />
      </div>
      {expenseCats.length > 0 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Статья</label>
          <Select value={categoryId} onChange={setCategoryId} placeholder="— оплата труда —" options={[{ value: "", label: "— оплата труда —" }, ...expenseCats.map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
      )}
      {projects.length > 0 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
            Проект {kind === "variable" ? "(за что)" : ""}
          </label>
          <Select value={projectId} onChange={setProjectId} placeholder="— без проекта —" options={[{ value: "", label: "— без проекта —" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Сумма</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" className="input w-32" />
        {subst && (
          <button type="button" onClick={applySalary} className="mt-1 block text-[11px] text-brand hover:underline">
            оклад {(subst.amount / 100).toLocaleString("ru-RU")} {subst.currency} — подставить
          </button>
        )}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Валюта</label>
        <Select value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">{loading ? "…" : "Сохранить"}</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
      </div>
      {error && <p className="w-full rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
    </form>
  );
}
