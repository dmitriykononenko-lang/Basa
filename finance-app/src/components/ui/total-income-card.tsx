"use client";

import * as React from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { MetricChart, formatCompact, type SeriesPoint } from "./metric-chart";

type Source = { name: string; amount: number; share: number };

const PERIODS = [
  { label: "3М", points: 3 },
  { label: "6М", points: 6 },
  { label: "12М", points: 12 },
];

export default function TotalIncomeCard({
  points,
  sources,
  sym = "₽",
  title = "Доходы",
  color = "#10b981",
}: {
  points: SeriesPoint[];
  sources: Source[];
  sym?: string;
  title?: string;
  color?: string;
}) {
  const EMERALD = color;
  const [period, setPeriod] = React.useState(PERIODS[1]); // 6М
  const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ${sym}`;

  const window = period.points < points.length ? points.slice(-period.points) : points;
  const total = window.reduce((s, p) => s + p.value, 0);
  const prev = points.slice(-2 * period.points, -period.points);
  const prevTotal = prev.reduce((s, p) => s + p.value, 0);
  const pct = prevTotal ? ((total - prevTotal) / prevTotal) * 100 : 0;
  const positive = pct >= 0;

  return (
    <div className="flex w-full flex-col gap-4 rounded-[28px] border border-border bg-card p-5 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-semibold tracking-tight text-muted-foreground">{title}</h3>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-3xl font-medium tracking-tight tabular-nums text-foreground">{money(total)}</span>
        {window.length >= 2 && (
          <span
            className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${
              positive
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                : "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400"
            }`}
          >
            {positive ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {Math.abs(pct).toFixed(1)}%
          </span>
        )}
      </div>

      {/* Переключатель периода */}
      <div className="flex w-full divide-x divide-border overflow-hidden rounded-lg border border-border">
        {PERIODS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setPeriod(p)}
            data-active={period.label === p.label}
            className="relative flex h-7 flex-1 items-center justify-center bg-transparent text-sm font-semibold text-muted-foreground outline-none transition hover:bg-foreground/5 data-[active=true]:bg-muted data-[active=true]:text-foreground"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* График */}
      <div className="relative h-[150px] w-full">
        {window.length >= 2 ? (
          <MetricChart
            series={[{ name: title, data: window, color: EMERALD }]}
            view="curve"
            valueFormatter={money}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Недостаточно данных</div>
        )}
      </div>

      {/* Источники дохода */}
      {sources.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {sources.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: EMERALD }} />
                <span className="truncate text-sm font-medium text-muted-foreground">{s.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-foreground">{formatCompact(s.amount)}</span>
                <span className="w-12 text-right text-xs font-medium text-muted-foreground">
                  {(s.share * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
