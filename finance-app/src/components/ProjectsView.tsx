"use client";

import { useEffect, useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { effectiveDue, businessDaysBetween, workdaysLabel } from "@/lib/workdays";

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
    return <span className="text-emerald-600 dark:text-emerald-400">✓ Сдан{p.completed_on ? ` ${formatDate(p.completed_on)}` : ""}</span>;
  }
  if (p.status !== "active") return <span className="text-slate-400">{p.status}</span>;
  const eff = effectiveDue(p.start_date, p.plan_work_days, p.due_date);
  const elapsed = businessDaysBetween(p.start_date, today);
  let tail: React.ReactNode = <span className="text-slate-400"> · срок не задан</span>;
  if (eff) {
    if (today > eff) tail = <span className="font-medium text-red-600 dark:text-red-400"> · просрочка {workdaysLabel(businessDaysBetween(eff, today))}</span>;
    else tail = <span className="text-slate-500 dark:text-neutral-400"> · до срока {workdaysLabel(businessDaysBetween(today, eff))}</span>;
  }
  return <span className="text-slate-400 dark:text-neutral-500">идёт {workdaysLabel(elapsed)}{tail}</span>;
}

export default function ProjectsView({
  projects, today, employees,
}: {
  projects: ProjectFull[];
  today: string;
  employees: { id: string; name: string }[];
}) {
  const [view, setView] = useState<"tiles" | "list">("tiles");
  const [resp, setResp] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    const v = localStorage.getItem("projects_view");
    if (v === "list" || v === "tiles") setView(v);
  }, []);
  function setMode(v: "tiles" | "list") {
    setView(v);
    localStorage.setItem("projects_view", v);
  }

  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);

  const filtered = useMemo(() => projects.filter((p) =>
    (!resp || p.responsible_counterparty_id === resp) &&
    (!from || p.start_date >= from) &&
    (!to || p.start_date <= to)
  ), [projects, resp, from, to]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Ответственный</label>
            <Select className="w-52" value={resp} onChange={setResp} placeholder="Все" options={[{ value: "", label: "Все" }, ...employees.map((e) => ({ value: e.id, label: e.name }))]} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Старт с</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input w-40 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">по</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input w-40 py-1.5 text-sm" />
          </div>
          {(resp || from || to) && (
            <button onClick={() => { setResp(""); setFrom(""); setTo(""); }} className="pb-1.5 text-xs text-slate-400 hover:text-brand">Сбросить</button>
          )}
        </div>
        <div className="inline-flex gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          <button onClick={() => setMode("tiles")} className={`rounded-full px-3 py-1 font-medium transition ${view === "tiles" ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>▦ Плитка</button>
          <button onClick={() => setMode("list")} className={`rounded-full px-3 py-1 font-medium transition ${view === "list" ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>☰ Список</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          {projects.length === 0 ? "Пока нет проектов." : "Нет проектов по фильтру."}
        </p>
      ) : view === "tiles" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 transition hover:ring-brand/40 dark:bg-[#15171c] dark:ring-white/[0.07] dark:hover:ring-brand/50">
              <div className="line-clamp-2 break-words text-sm font-medium text-slate-800 dark:text-neutral-200">{p.name}</div>
              <div className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
                {p.status === "active" ? "Активный" : p.status === "done" ? "Сдан" : p.status}
                {p.responsible_counterparty_id && empName.get(p.responsible_counterparty_id) && <> · {empName.get(p.responsible_counterparty_id)}</>}
              </div>
              <div className="mt-2 text-xs text-slate-400 dark:text-neutral-500">старт {formatDate(p.start_date)}</div>
              <div className="mt-0.5 text-xs">{deadlineNode(p, today)}</div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="px-5 py-3 font-medium">Проект</th>
                <th className="px-5 py-3 font-medium">Ответственный</th>
                <th className="px-5 py-3 font-medium">Старт</th>
                <th className="px-5 py-3 font-medium">Срок / сдан</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/projects/${p.id}`} className="text-slate-800 hover:text-brand dark:text-neutral-200">{p.name}</Link>
                  </td>
                  <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">
                    {p.responsible_counterparty_id ? empName.get(p.responsible_counterparty_id) ?? "—" : "—"}
                  </td>
                  <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{formatDate(p.start_date)}</td>
                  <td className="px-5 py-3 text-xs">{deadlineNode(p, today)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
