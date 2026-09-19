"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Sparkline from "@/components/metrics/Sparkline";
import type { MetricWithData } from "@/components/metrics/MetricsView";
import {
  metricStatus, achievement, formatMetric, pctChange, stateColor, trendColor,
  STATE_LABELS, PERIOD_LABELS, type MetricPeriod, type MetricStateKey,
} from "@/lib/metrics";

type Row = ReturnType<typeof buildRows>[number];

function buildRows(metrics: MetricWithData[]) {
  return metrics.filter((m) => m.is_active).map((m) => {
    const st = metricStatus(m.series, m);
    const delta = st.last != null && st.prev != null ? st.last - st.prev : null;
    const pct = pctChange(st.prev, st.last);
    const ach = achievement(m.current, m.plan, m.direction);
    return { m, st, delta, pct, ach };
  });
}

// Порядок «требует внимания» → рост → стабильно.
const STATE_ORDER: Record<MetricStateKey, number> = { problem: 0, empty: 1, falling: 2, steady: 3, growing: 4 };

export default function MetricsDynamics({ metrics }: { metrics: MetricWithData[] }) {
  const rows = useMemo(() => buildRows(metrics), [metrics]);
  const [sort, setSort] = useState<"state" | "growth" | "name">("state");

  const sorted = useMemo(() => {
    const r = [...rows];
    if (sort === "name") r.sort((a, b) => a.m.name.localeCompare(b.m.name, "ru"));
    else if (sort === "growth") r.sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity));
    else r.sort((a, b) => STATE_ORDER[a.st.state] - STATE_ORDER[b.st.state] || a.m.name.localeCompare(b.m.name, "ru"));
    return r;
  }, [rows, sort]);

  const withPct = rows.filter((r) => r.pct != null) as (Row & { pct: number })[];
  const leaders = [...withPct].filter((r) => r.st.trend === "up").sort((a, b) => b.pct - a.pct).slice(0, 3);
  const laggards = [...withPct].filter((r) => r.st.trend === "down").sort((a, b) => a.pct - b.pct).slice(0, 3);
  const problems = rows.filter((r) => r.st.state === "problem").length;

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/metrics" className="text-sm text-slate-400 hover:text-brand">← Показатели</Link>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Динамика показателей</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">Тренды, изменение к прошлому периоду и выполнение плана</p>
        </div>
        <div className="inline-flex rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          {([["state", "По вниманию"], ["growth", "По росту"], ["name", "По имени"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setSort(v)}
              className={`rounded-full px-3.5 py-1.5 font-medium transition ${sort === v ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 dark:text-neutral-400"}`}>
              {l}
            </button>
          ))}
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-neutral-400">Активных показателей нет.</p>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MoverCard title="Лидеры роста" tone="good" rows={leaders} />
            <MoverCard title="Зоны падения" tone="warn" rows={laggards} />
            <div className="surface rounded-3xl p-5">
              <div className="text-[46px] font-bold leading-none tabular-nums text-red-600 dark:text-red-400">{problems}</div>
              <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Требуют внимания</div>
            </div>
          </div>

          <div className="surface overflow-x-auto rounded-3xl">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                  <th className="px-5 py-3 font-medium">Показатель</th>
                  <th className="px-4 py-3 font-medium">Тренд</th>
                  <th className="px-4 py-3 text-right font-medium">Текущее</th>
                  <th className="px-4 py-3 text-right font-medium">Δ к пред.</th>
                  <th className="px-4 py-3 text-right font-medium">План · %</th>
                  <th className="px-4 py-3 font-medium">Состояние</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ m, st, delta, pct, ach }) => (
                  <tr key={m.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.04]">
                    <td className="px-5 py-3">
                      <Link href={`/metrics/${m.id}`} className="font-medium text-slate-800 hover:text-brand dark:text-neutral-200">{m.name}</Link>
                      <div className="mt-0.5 text-[11px] text-slate-400 dark:text-neutral-500">
                        {PERIOD_LABELS[m.period as MetricPeriod]}{m.unitName ? ` · ${m.unitName}` : ""}{m.ownerName ? ` · ${m.ownerName}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3"><Sparkline series={m.series} color={stateColor(st.state)} width={72} height={26} /></td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900 dark:text-white">{formatMetric(m.current, m.unit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium" style={{ color: delta != null && st.trend !== "flat" ? trendColor(st.trend) : undefined }}>
                      {delta == null || st.trend === "flat" ? <span className="text-slate-300 dark:text-neutral-600">—</span> : (
                        <>{delta > 0 ? "▲ +" : "▼ −"}{formatMetric(Math.abs(delta), m.unit)}{pct != null ? ` (${pct > 0 ? "+" : ""}${Math.round(pct)}%)` : ""}</>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500 dark:text-neutral-400">
                      {m.plan == null ? "—" : <>{formatMetric(m.plan, m.unit)}{ach.pct != null ? <span className={`ml-1 font-medium ${ach.good ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{Math.round(ach.pct)}%</span> : null}</>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: stateColor(st.state), background: `${stateColor(st.state)}1a` }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: stateColor(st.state) }} />{STATE_LABELS[st.state]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function MoverCard({ title, tone, rows }: { title: string; tone: "good" | "warn"; rows: (Row & { pct: number })[] }) {
  const col = tone === "good" ? "#10b981" : "#f59e0b";
  return (
    <div className="surface rounded-3xl p-5">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">{title}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-neutral-500">—</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.m.id} className="flex items-center justify-between gap-2 text-sm">
              <Link href={`/metrics/${r.m.id}`} className="truncate text-slate-700 hover:text-brand dark:text-neutral-300">{r.m.name}</Link>
              <span className="shrink-0 font-semibold tabular-nums" style={{ color: col }}>{r.pct > 0 ? "+" : ""}{Math.round(r.pct)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
