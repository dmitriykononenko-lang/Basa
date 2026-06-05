"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EMPLOYMENT_TYPES, CURRENCIES } from "@/lib/constants";

export default function AddEmployeeForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [type, setType] = useState("salary");
  const [currency, setCurrency] = useState("RUB");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from("employees").insert({
      team_id: teamId,
      name,
      start_date: startDate || null,
      employment_type: type,
      payout_currency: currency,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setName("");
    setStartDate("");
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        + Добавить сотрудника
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]"
    >
      <div className="min-w-[180px] flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Имя</label>
        <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Иванов" className="input" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Дата начала</label>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Тип занятости</label>
        <select value={type} onChange={(e) => setType(e.target.value)} className="input">
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Валюта выплат</label>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input">
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
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
