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
  manager_counterparty_id: string | null;
  bonus_amount: number | null;
  bonus_currency: string | null;
};

type StateKey = "active" | "overdue" | "done" | "other";

// Состояние проекта для пилюли статуса и фильтра по вкладкам.
function projectState(p: ProjectFull, today: string): StateKey {
  if (p.status === "done") return "done";
  if (p.status !== "active") return "other";
  const eff = effectiveDue(p.start_date, p.plan_work_days, p.due_date);
  return eff && today > eff ? "overdue" : "active";
}

const STATE_PILL: Record<StateKey, { label: string; cls: string }> = {
  active: { label: "Активный", cls: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" },
  overdue: { label: "Просрочен", cls: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300" },
  done: { label: "Сдан", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  other: { label: "В архиве", cls: "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-neutral-400" },
};

// Плановый объём в рабочих днях (из plan_work_days либо из срока).
function planWd(p: ProjectFull): number | null {
  if (p.plan_work_days != null) return p.plan_work_days;
  if (p.due_date) return businessDaysBetween(p.start_date, p.due_date) || null;
  return null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((s) => s[0]?.toUpperCase() ?? "").join("") || "—";
}

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

// Прогресс-полоса по рабочим дням (план vs прошло).
function Progress({ p, today }: { p: ProjectFull; today: string }) {
  const state = projectState(p, today);
  if (state === "done") {
    return <div className="h-1.5 w-full rounded-full bg-emerald-500/80" />;
  }
  const plan = planWd(p);
  if (!plan) return <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-white/[0.06]" />;
  const elapsed = businessDaysBetween(p.start_date, today);
  const pct = Math.max(2, Math.min(100, (elapsed / plan) * 100));
  const bar = state === "overdue" ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-brand";
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-white/[0.06]">
      <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "active", label: "Активные" },
  { key: "overdue", label: "Просроченные" },
  { key: "done", label: "Сданные" },
];

export default function ProjectsView({
  projects, today, employees,
}: {
  projects: ProjectFull[];
  today: string;
  employees: { id: string; name: string }[];
}) {
  const [view, setView] = useState<"tiles" | "list">("tiles");
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
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

  // Счётчики состояний (по всем проектам, до текстовых фильтров).
  const counts = useMemo(() => {
    const c = { active: 0, overdue: 0, done: 0 };
    for (const p of projects) {
      const s = projectState(p, today);
      if (s === "active" || s === "overdue") c.active++;
      if (s === "overdue") c.overdue++;
      if (s === "done") c.done++;
    }
    return c;
  }, [projects, today]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return projects.filter((p) => {
      const s = projectState(p, today);
      const tabOk =
        tab === "all" ? true :
        tab === "active" ? s === "active" || s === "overdue" :
        tab === "overdue" ? s === "overdue" :
        tab === "done" ? s === "done" : true;
      return tabOk &&
        (!ql || p.name.toLowerCase().includes(ql)) &&
        (!resp || p.responsible_counterparty_id === resp) &&
        (!from || p.start_date >= from) &&
        (!to || p.start_date <= to);
    });
  }, [projects, today, tab, q, resp, from, to]);

  const hasFilter = !!(q || resp || from || to);

  return (
    <div>
      {/* Сводка по состояниям */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <StatChip label="Активные" value={counts.active} tone="brand" />
        <StatChip label="Просрочено" value={counts.overdue} tone={counts.overdue > 0 ? "red" : "muted"} />
        <StatChip label="Сдано" value={counts.done} tone="emerald" />
      </div>

      {/* Вкладки состояния + переключатель вида */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3.5 py-1.5 font-medium transition ${tab === t.key ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"}`}
            >
              {t.label}
              {t.key === "overdue" && counts.overdue > 0 && <span className="ml-1.5 rounded-full bg-red-500/15 px-1.5 text-xs font-semibold text-red-500">{counts.overdue}</span>}
            </button>
          ))}
        </div>
        <div className="inline-flex gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          <button onClick={() => setMode("tiles")} className={`rounded-full px-3 py-1 font-medium transition ${view === "tiles" ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>▦ Плитка</button>
          <button onClick={() => setMode("list")} className={`rounded-full px-3 py-1 font-medium transition ${view === "list" ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>☰ Список</button>
        </div>
      </div>

      {/* Поиск и фильтры */}
      <div className="mb-5 flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Поиск</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название проекта…" className="input w-full py-1.5 text-sm" />
        </div>
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
        {hasFilter && (
          <button onClick={() => { setQ(""); setResp(""); setFrom(""); setTo(""); }} className="pb-2 text-xs text-slate-400 hover:text-brand">Сбросить</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          {projects.length === 0 ? "Пока нет проектов." : "Нет проектов по фильтру."}
        </p>
      ) : view === "tiles" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const state = projectState(p, today);
            const pill = STATE_PILL[state];
            const respName = p.responsible_counterparty_id ? empName.get(p.responsible_counterparty_id) : null;
            const mgrName = p.manager_counterparty_id ? empName.get(p.manager_counterparty_id) : null;
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className={`flex flex-col rounded-3xl bg-white p-5 ring-1 transition hover:ring-brand/40 dark:bg-[#15171c] dark:hover:ring-brand/50 ${
                  state === "overdue" ? "ring-red-200 dark:ring-red-500/25" : "ring-slate-200/80 dark:ring-white/[0.07]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="line-clamp-2 break-words text-sm font-semibold text-slate-800 dark:text-neutral-100">{p.name}</div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${pill.cls}`}>{pill.label}</span>
                </div>

                {(respName || mgrName) && (
                  <div className="mt-3 space-y-1.5">
                    {respName && (
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">{initials(respName)}</span>
                        <span className="truncate text-xs text-slate-500 dark:text-neutral-400"><span className="text-slate-400 dark:text-neutral-500">аналитик</span> · {respName}</span>
                      </div>
                    )}
                    {mgrName && (
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-neutral-300">{initials(mgrName)}</span>
                        <span className="truncate text-xs text-slate-500 dark:text-neutral-400"><span className="text-slate-400 dark:text-neutral-500">менеджер</span> · {mgrName}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3">
                  <Progress p={p} today={today} />
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400 dark:text-neutral-500">старт {formatDate(p.start_date)}</span>
                  <span>{deadlineNode(p, today)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="px-5 py-3 font-medium">Проект</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Аналитик / менеджер</th>
                <th className="w-40 px-5 py-3 font-medium">Прогресс</th>
                <th className="px-5 py-3 font-medium">Старт</th>
                <th className="px-5 py-3 font-medium">Срок / сдан</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const state = projectState(p, today);
                const pill = STATE_PILL[state];
                const respName = p.responsible_counterparty_id ? empName.get(p.responsible_counterparty_id) ?? "—" : "—";
                const mgrName = p.manager_counterparty_id ? empName.get(p.manager_counterparty_id) : null;
                return (
                  <tr key={p.id} className={`border-b border-slate-50 last:border-0 dark:border-white/[0.05] ${state === "overdue" ? "bg-red-50/40 dark:bg-red-500/[0.04]" : ""}`}>
                    <td className="px-5 py-3 font-medium">
                      <Link href={`/projects/${p.id}`} className="text-slate-800 hover:text-brand dark:text-neutral-200">{p.name}</Link>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${pill.cls}`}>{pill.label}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">
                      {respName}
                      {mgrName && <span className="block text-xs text-slate-400 dark:text-neutral-500">менеджер: {mgrName}</span>}
                    </td>
                    <td className="px-5 py-3"><Progress p={p} today={today} /></td>
                    <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{formatDate(p.start_date)}</td>
                    <td className="px-5 py-3 text-xs">{deadlineNode(p, today)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: "brand" | "red" | "emerald" | "muted" }) {
  const map = {
    brand: "text-brand",
    red: "text-red-600 dark:text-red-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    muted: "text-slate-400 dark:text-neutral-500",
  };
  return (
    <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-xs text-slate-500 dark:text-neutral-400">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold ${map[tone]}`}>{value}</div>
    </div>
  );
}
