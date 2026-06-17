"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { effectiveDue, businessDaysBetween, workdaysLabel } from "@/lib/workdays";
import EditProjectForm from "@/components/EditProjectForm";

export type ProjectFull = {
  id: string;
  name: string;
  status: string;
  start_date: string;
  plan_work_days: number | null;
  due_date: string | null;
  completed_on: string | null;
  responsible_counterparty_id: string | null;
  bonus_amount: number | null;
  bonus_currency: string | null;
};

function deadlineNode(p: ProjectFull, today: string) {
  if (p.status === "done") {
    return <span className="text-emerald-600 dark:text-emerald-400">✓ Сдан{p.completed_on ? ` ${new Date(p.completed_on).toLocaleDateString("ru-RU")}` : ""}</span>;
  }
  if (p.status !== "active") return <span className="text-slate-400">{p.status}</span>;
  const eff = effectiveDue(p.start_date, p.plan_work_days, p.due_date);
  const elapsed = businessDaysBetween(p.start_date, today);
  let tail: React.ReactNode = null;
  if (eff) {
    if (today > eff) tail = <span className="font-medium text-red-600 dark:text-red-400"> · просрочка {workdaysLabel(businessDaysBetween(eff, today))}</span>;
    else tail = <span className="text-slate-500 dark:text-neutral-400"> · до срока {workdaysLabel(businessDaysBetween(today, eff))}</span>;
  } else {
    tail = <span className="text-slate-400"> · срок не задан</span>;
  }
  return <span className="text-slate-400 dark:text-neutral-500">идёт {workdaysLabel(elapsed)}{tail}</span>;
}

export default function ProjectsView({
  projects, today, employees, canEdit,
}: {
  projects: ProjectFull[];
  today: string;
  employees: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"tiles" | "list">("tiles");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const v = localStorage.getItem("projects_view");
    if (v === "list" || v === "tiles") setView(v);
  }, []);
  function setMode(v: "tiles" | "list") {
    setView(v);
    localStorage.setItem("projects_view", v);
  }

  async function del(p: ProjectFull) {
    if (!confirm(`Удалить проект «${p.name}»? Если есть связанные операции — проект будет архивирован.`)) return;
    setBusy(p.id);
    const supabase = createClient();
    const { error } = await supabase.from("projects").delete().eq("id", p.id);
    if (error) {
      const { error: e2 } = await supabase.from("projects").update({ archived: true }).eq("id", p.id);
      setBusy(null);
      if (e2) return toast.error(e2.message);
      toast.success("Проект архивирован (есть связанные операции)");
    } else {
      setBusy(null);
      toast.success("Проект удалён");
    }
    router.refresh();
  }

  function editProps(p: ProjectFull) {
    return {
      projectId: p.id, name: p.name, status: p.status, responsibleId: p.responsible_counterparty_id,
      employees, startDate: p.start_date, planWorkDays: p.plan_work_days, dueDate: p.due_date,
      completedOn: p.completed_on, bonusAmount: p.bonus_amount ?? 0, bonusCurrency: p.bonus_currency ?? "RUB",
    };
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <div className="inline-flex gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          <button onClick={() => setMode("tiles")} className={`rounded-full px-3 py-1 font-medium transition ${view === "tiles" ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>▦ Плитка</button>
          <button onClick={() => setMode("list")} className={`rounded-full px-3 py-1 font-medium transition ${view === "list" ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>☰ Список</button>
        </div>
      </div>

      {view === "tiles" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div key={p.id} className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
              <Link href={`/projects/${p.id}`} className="block hover:text-brand">
                <div className="line-clamp-2 break-words text-sm font-medium text-slate-800 dark:text-neutral-200">{p.name}</div>
                <div className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
                  {p.status === "active" ? "Активный" : p.status === "done" ? "Сдан" : p.status}
                </div>
                <div className="mt-2 text-xs">{deadlineNode(p, today)}</div>
              </Link>
              {canEdit && (
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
                  <EditProjectForm {...editProps(p)} />
                  <button onClick={() => del(p)} disabled={busy === p.id} className="rounded-full px-2 py-1 text-xs text-red-500 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40">Удалить</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="px-5 py-3 font-medium">Проект</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Срок</th>
                {canEdit && <th className="px-5 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/projects/${p.id}`} className="text-slate-800 hover:text-brand dark:text-neutral-200">{p.name}</Link>
                  </td>
                  <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">
                    {p.status === "active" ? "Активный" : p.status === "done" ? "Сдан" : p.status}
                  </td>
                  <td className="px-5 py-3 text-xs">{deadlineNode(p, today)}</td>
                  {canEdit && (
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <EditProjectForm {...editProps(p)} />
                        <button onClick={() => del(p)} disabled={busy === p.id} className="rounded-full px-2 py-1 text-xs text-red-500 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40">Удалить</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {projects.length === 0 && (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Пока нет проектов.
        </p>
      )}
    </div>
  );
}
