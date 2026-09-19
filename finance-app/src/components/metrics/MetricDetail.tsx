"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { Select } from "@/components/ui/select";
import ExportButton from "@/components/ExportButton";
import { MetricChart, type ChartSeries } from "@/components/ui/metric-chart";
import {
  achievement,
  formatMetric,
  periodLabel,
  periodStart,
  recentPeriodStarts,
  metricStatus,
  STATE_LABELS,
  stateColor,
  PERIOD_LABELS,
  DIRECTION_LABELS,
  type Metric,
  type MetricValue,
  type MetricPeriod,
} from "@/lib/metrics";

export default function MetricDetail({
  metric,
  values,
  ownerName,
  unitName,
  canEnter,
  uid,
}: {
  metric: Metric;
  values: MetricValue[];
  ownerName: string | null;
  unitName: string | null;
  canEnter: boolean;
  uid: string | null;
}) {
  const router = useRouter();
  const supabase = useState(() => createClient())[0];
  const [rows, setRows] = useState<MetricValue[]>(values);

  // форма ввода: последние 26 периодов + выбор произвольной даты (за старый период)
  const periodOptions = useMemo(() => {
    const starts = recentPeriodStarts(new Date(), metric.period as MetricPeriod, 26);
    return starts.slice().reverse().map((ps) => ({ value: ps, label: periodLabel(ps, metric.period as MetricPeriod) }));
  }, [metric.period]);
  const [pStart, setPStart] = useState(periodOptions[0]?.value ?? "");
  const [val, setVal] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const byPeriod = useMemo(() => new Map(rows.map((r) => [r.period_start, r])), [rows]);

  // Авто-состояние метрики по всему ряду.
  const status = useMemo(
    () => metricStatus(rows.map((r) => ({ period_start: r.period_start, value: r.value })), metric),
    [rows, metric],
  );

  // график: последние 12 периодов, точки с фактом + линия плана
  const chartSeries: ChartSeries[] = useMemo(() => {
    const starts = recentPeriodStarts(new Date(), metric.period as MetricPeriod, 12);
    const plotted = starts.filter((ps) => byPeriod.has(ps));
    const fact = plotted.map((ps) => ({ value: byPeriod.get(ps)!.value, date: periodLabel(ps, metric.period as MetricPeriod) }));
    const out: ChartSeries[] = [{ name: "Факт", data: fact, color: stateColor(status.state) }];
    if (metric.plan != null && plotted.length > 0) {
      out.push({ name: "План", data: plotted.map((ps) => ({ value: metric.plan as number, date: periodLabel(ps, metric.period as MetricPeriod) })), color: "#f59e0b" });
    }
    return out;
  }, [byPeriod, metric.period, metric.plan, status.state]);
  const hasChart = (chartSeries[0]?.data.length ?? 0) >= 2;

  // текущее значение и тренд
  const sortedDesc = useMemo(() => rows.slice().sort((a, b) => (a.period_start < b.period_start ? 1 : -1)), [rows]);
  const current = sortedDesc[0]?.value ?? null;
  const prev = sortedDesc[1]?.value ?? null;
  const { pct, good } = achievement(current, metric.plan, metric.direction);

  function startEdit(r: MetricValue) {
    setPStart(r.period_start);
    setVal(String(r.value));
    setNote(r.note);
  }

  function pickDate(dateStr: string) {
    if (!dateStr) return;
    setPStart(periodStart(new Date(`${dateStr}T00:00:00Z`), metric.period as MetricPeriod));
  }

  async function save() {
    if (!pStart) return;
    const v = Number(val.replace(",", "."));
    if (val.trim() === "" || !Number.isFinite(v)) {
      toast.error("Введите число");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("metric_values")
      .upsert(
        { team_id: metric.team_id, metric_id: metric.id, period_start: pStart, value: v, note: note.trim(), entered_by: uid },
        { onConflict: "metric_id,period_start" },
      )
      .select("id, metric_id, period_start, value, note")
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error(error?.message ?? "Ошибка");
      return;
    }
    const row = { ...(data as MetricValue), value: Number((data as MetricValue).value) };
    setRows((prev) => {
      const rest = prev.filter((r) => r.period_start !== pStart);
      return [...rest, row];
    });
    setVal("");
    setNote("");
    toast.success("Сохранено");
  }

  async function del(r: MetricValue) {
    if (!confirm(`Удалить значение за ${periodLabel(r.period_start, metric.period as MetricPeriod)}?`)) return;
    const { error } = await supabase.from("metric_values").delete().eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    toast.success("Удалено");
  }

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-8">
      <Link href="/metrics" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-brand dark:text-neutral-400">
        ← Все показатели
      </Link>

      <header className="mb-5">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{metric.name}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400 dark:text-neutral-500">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ color: stateColor(status.state), background: `${stateColor(status.state)}1a` }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: stateColor(status.state) }} />
            {STATE_LABELS[status.state]}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-neutral-800">{PERIOD_LABELS[metric.period as MetricPeriod]}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-neutral-800">{DIRECTION_LABELS[metric.direction]}</span>
          {unitName && <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-neutral-800">{unitName}</span>}
          {ownerName && <span>· ответственный: {ownerName}</span>}
        </div>
      </header>

      {/* Сводка */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Текущий факт" value={formatMetric(current, metric.unit)} accent={good == null ? "" : good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"} />
        <Stat label="План" value={formatMetric(metric.plan, metric.unit)} />
        <Stat label="Выполнение" value={pct != null ? `${Math.round(pct)}%` : "—"} accent={pct == null ? "" : good ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"} />
      </div>
      {prev != null && current != null && (
        <p className="mb-5 text-xs text-slate-400 dark:text-neutral-500">
          К прошлому периоду: {current - prev >= 0 ? "▲ +" : "▼ "}{formatMetric(Math.abs(current - prev), metric.unit)}
        </p>
      )}

      {/* График */}
      {hasChart && (
        <div className="surface mb-5 rounded-3xl p-5">
          <div className="mb-2 flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: chartSeries[0].color }} /> Факт</span>
            {chartSeries[1] && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> План</span>}
          </div>
          <div className="relative h-56 w-full">
            <MetricChart series={chartSeries} view="curve" valueFormatter={(v) => formatMetric(v, "")} />
          </div>
        </div>
      )}

      {/* Ввод значения */}
      {canEnter && (
        <div className="surface mb-5 rounded-3xl p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-800 dark:text-neutral-100">Вписать факт</h2>
          <p className="mb-3 text-xs text-slate-400 dark:text-neutral-500">Вносим за период: <b className="text-slate-600 dark:text-neutral-300">{pStart ? periodLabel(pStart, metric.period as MetricPeriod) : "—"}</b></p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="sm:w-40">
              <span className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Период</span>
              <Select value={pStart} onChange={setPStart} options={periodOptions} />
            </label>
            <label className="sm:w-40">
              <span className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">…или дата (старый период)</span>
              <input type="date" onChange={(e) => pickDate(e.target.value)} className="input w-full" />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Значение</span>
              <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" placeholder="факт" className="input w-full" onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">Заметка (необязательно)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="комментарий" className="input w-full" />
            </label>
            <button onClick={save} disabled={busy} className="btn-primary shrink-0 disabled:opacity-50">{busy ? "…" : "Сохранить"}</button>
          </div>
        </div>
      )}

      {/* История */}
      <div className="surface rounded-3xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-100">История</h2>
          <ExportButton
            filename={`metric-${metric.name}.csv`}
            headers={["Период", "Факт", "План", "Заметка"]}
            rows={sortedDesc.map((r) => [periodLabel(r.period_start, metric.period as MetricPeriod), r.value, metric.plan ?? "", r.note])}
          />
        </div>
        {sortedDesc.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400 dark:text-neutral-500">Значений пока нет.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
            {sortedDesc.map((r) => {
              const a = achievement(r.value, metric.plan, metric.direction);
              return (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <span className="w-28 shrink-0 text-sm text-slate-500 dark:text-neutral-400">{periodLabel(r.period_start, metric.period as MetricPeriod)}</span>
                  <span className={`font-medium ${a.good == null ? "text-slate-800 dark:text-neutral-200" : a.good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {formatMetric(r.value, metric.unit)}
                  </span>
                  {r.note && <span className="truncate text-xs text-slate-400 dark:text-neutral-500">{r.note}</span>}
                  {canEnter && (
                    <span className="ml-auto flex shrink-0 gap-2">
                      <button onClick={() => startEdit(r)} className="text-xs text-brand hover:underline">править</button>
                      <button onClick={() => del(r)} className="text-xs text-slate-400 hover:text-red-500">удалить</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent = "" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="surface rounded-2xl p-4">
      <div className="text-xs text-slate-400 dark:text-neutral-500">{label}</div>
      <div className={`mt-0.5 text-xl font-bold ${accent || "text-slate-900 dark:text-white"}`}>{value}</div>
    </div>
  );
}
