"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import type { KbDepartment } from "@/lib/kb";

export default function DepartmentManager({
  teamId,
  departments,
}: {
  teamId: string;
  departments: KbDepartment[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("kb_departments")
      .insert({ team_id: teamId, name: name.trim(), created_by: auth.user?.id });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setName("");
    toast.success("Отдел добавлен");
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Удалить отдел? Привязки материалов к нему будут сняты.")) return;
    const supabase = createClient();
    const { error } = await supabase.from("kb_departments").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Удалено");
    router.refresh();
  }

  return (
    <div className="max-w-xl space-y-4">
      <form onSubmit={add} className="flex items-end gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
            Название отдела
          </label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Отдел продаж" className="input" />
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "…" : "Добавить"}
        </button>
      </form>

      {departments.length > 0 ? (
        <ul className="surface divide-y divide-slate-100 overflow-hidden rounded-3xl dark:divide-white/[0.07]">
          {departments.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-slate-800 dark:text-neutral-200">{d.name}</span>
              <button type="button" onClick={() => remove(d.id)} className="btn-ghost text-sm">
                Удалить
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">Отделов пока нет.</p>
      )}
    </div>
  );
}
