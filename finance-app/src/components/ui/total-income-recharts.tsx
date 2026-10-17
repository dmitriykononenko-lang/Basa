"use client";

import * as React from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, type SeriesPoint } from "./metric-chart";

type Source = { name: string; amount: number; share: number };

const PERIODS = [
  { label: "3М", points: 3 },
  { label: "6М", points: 6 },
  { label: "12М", points: 12 },
];

const COLOR = "#2f6df6"; // brand

type TooltipProps = {
  active?: boolean;
  payload?: { value: number; payload: { date: string } }[];
  fmt: (n: number) => string;
};

function ChartTooltip({ active, payload, fmt }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg">
      <div className="text-muted-foreground">{p.payload.date}</div>
      <div className="font-medium text-foreground">{fmt(p.value)}</div>
    </div>
  );
}

export default function TotalIncomeRecharts({
  points,
  sources,
  sym = "₽",
  title = "Доходы",
}: {
  points: SeriesPoint[];
  sources: Source[];
  sym?: string;
  title?: string;
}) {
  const [period, setPeriod] = React.useState(PERIODS[1]);
  const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ${sym}`;

  const window = period.points < points.length ? points.slice(-period.points) : points;
  const total = window.reduce((s, p) => s + p.value, 0);
  const prev = points.slice(-2 * period.points, -period.points);
  const prevTotal = prev.reduce((s, p) => s + p.value, 0);
  const pct = prevTotal ? ((total - prevTotal) / prevTotal) * 100 : 0;
  const positive = pct >= 0;

  return (
    <div className="flex w-full flex-col gap-4 rounded-[28px] border border-border bg-card p-5 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <h3 className="text-[16px] font-semibold tracking-tight text-muted-foreground">{title}</h3>

      <div className="flex items-center gap-2">
        <span className="text-3xl font-medium tracking-tight tabular-nums text-foreground">{money(total)}</span>
        {window.length >= 2 && (
          <span className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            positive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400" : "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400"
          }`}>
            {positive ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {Math.abs(pct).toFixed(1)}%
          </span>
        )}
      </div>

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

      <div className="h-[150px] w-full">
        {window.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={window} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
              <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border)" />
              <XAxis dataKey="date" hide />
              <YAxis hide domain={["dataMin - 10", "dataMax + 10"]} />
              <Tooltip content={<ChartTooltip fmt={money} />} cursor={{ stroke: COLOR, strokeWidth: 1 }} />
              <Line type="monotone" dataKey="value" stroke={COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: COLOR, stroke: "#fff", strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Недостаточно данных</div>
        )}
      </div>

      {sources.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {sources.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR }} />
                <span className="truncate text-sm font-medium text-muted-foreground">{s.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-foreground">{formatCompact(s.amount)}</span>
                <span className="w-12 text-right text-xs font-medium text-muted-foreground">{(s.share * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
