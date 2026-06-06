"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Combobox from "@/components/Combobox";

const STATUSES: { value: string; label: string }[] = [
  { value: "active", label: "Активный" },
  { value: "done", label: "Завершён" },
  { value: "archived", label: "В архиве" },
];

export default function EditProjectForm({
  projectId, name: initialName, status: initialStatus, responsibleId, employees,
}: {
  projectId: string;
  name: string;
  status: string;
  responsibleId: string | null;
  employees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState(initialStatus);
  const [responsible, setResponsible] = useState(responsibleId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("projects")
      .update({ name: name.trim(), status, responsible_counterparty_id: responsible || null })
      .eq("id", projectId);
    if (error) { setError(error.message); setLoading(false); return; }
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost">Редактировать</button>
    );
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
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input w-full">
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Ответственный сотрудник</label>
          <Combobox
            value={responsible}
            onChange={setResponsible}
            options={employees.map((e) => ({ value: e.id, label: e.name }))}
            placeholder="— не назначен —"
            emptyLabel="— не назначен —"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">{loading ? "…" : "Сохранить"}</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Отмена</button>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">{error}</p>}
    </form>
  );
}
