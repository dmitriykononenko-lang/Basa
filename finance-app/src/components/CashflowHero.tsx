"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/format";

export type HeroPoint = { label: string; value: number; forecast?: boolean };

const PERIODS: { key: string; months: number }[] = [
  { key: "3M", months: 3 },
  { key: "6M", months: 6 },
  { key: "12M", months: 12 },
];

const PAD = 10; // % вертикальный отступ

function smooth(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const d = [`M ${pts[0].x} ${pts[0].y}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`);
  }
  return d.join(" ");
}

export default function CashflowHero({ points, base }: { points: HeroPoint[]; base: string }) {
  const [period, setPeriod] = useState("6M");
  const [hover, setHover] = useState<number | null>(null);

  const window = useMemo(() => {
    const months = PERIODS.find((p) => p.key === period)?.months ?? 6;
    const actual = points.filter((p) => !p.forecast);
    const forecast = points.filter((p) => p.forecast);
    return [...actual.slice(-months), ...forecast];
  }, [points, period]);

  const lastActualIdx = useMemo(() => {
    let bi = -1;
    window.forEach((p, i) => { if (!p.forecast) bi = i; });
    return bi;
  }, [window]);

  const values = window.map((p) => p.value);
  const current = lastActualIdx >= 0 ? window[lastActualIdx].value : (values[values.length - 1] ?? 0);

  // Кассовый разрыв — минимальная прогнозная точка ниже нуля
  const gap = useMemo(() => {
    let g: { value: number; label: string; idx: number } | null = null;
    window.forEach((p, i) => { if (p.forecast && p.value < 0 && (!g || p.value < g.value)) g = { value: p.value, label: p.label, idx: i }; });
    return g as { value: number; label: string; idx: number } | null;
  }, [window]);

  const n = window.length;
  const dataMin = Math.min(0, ...values);
  const dataMax = Math.max(...values, dataMin + 1);
  const range = dataMax - dataMin || 1;
  const lo = dataMin - range * 0.12, hi = dataMax + range * 0.12;
  const xOf = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const yOf = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (100 - 2 * PAD);

  const pts = window.map((p, i) => ({ x: xOf(i), y: yOf(p.value) }));
  const bi = lastActualIdx >= 0 ? lastActualIdx : n - 1;
  const actualLine = smooth(pts.slice(0, bi + 1));
  const forecastLine = bi < n - 1 ? smooth(pts.slice(bi)) : "";
  const areaBase = 100 - PAD;
  const zeroY = yOf(0);
  const showZero = dataMin < 0;

  const active = hover != null ? Math.max(0, Math.min(n - 1, hover)) : null;

  return (
    <section className="rounded-[28px] border border-border bg-card p-5 shadow-[0_2px_10px_rgba(0,0,0,0.04)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-muted-foreground">Денежные средства на счетах</div>
          <div className="mt-1 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{formatMoney(current, base)}</div>
          <div className="mt-2">
            {gap ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-600 dark:bg-red-500/15 dark:text-red-300">
                ⚠️ Кассовый разрыв в {gap.label}: {formatMoney(gap.value, base)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                ✓ Кассовых разрывов не прогнозируется
              </span>
            )}
          </div>
        </div>
        <div className="inline-flex divide-x divide-border overflow-hidden rounded-lg border border-border text-sm">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
              data-active={period === p.key}
              className="px-4 py-1.5 font-semibold text-muted-foreground transition hover:bg-foreground/5 data-[active=true]:bg-muted data-[active=true]:text-foreground">
              {p.key}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-4 h-52 w-full"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * (n - 1)));
        }}
        onMouseLeave={() => setHover(null)}>
        <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
          <defs>
            <linearGradient id="cfh-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2f6df6" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#2f6df6" stopOpacity="0" />
            </linearGradient>
          </defs>
          {showZero && <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="currentColor" className="text-red-400/40" strokeWidth="0.5" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
          {actualLine && <path d={`${actualLine} L ${pts[bi].x} ${areaBase} L ${pts[0].x} ${areaBase} Z`} fill="url(#cfh-fill)" stroke="none" />}
          {actualLine && <path d={actualLine} fill="none" stroke="#2f6df6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          {forecastLine && <path d={forecastLine} fill="none" stroke="#2f6df6" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" vectorEffect="non-scaling-stroke" />}
          {gap && <circle cx={xOf(gap.idx)} cy={yOf(gap.value)} r="2" fill="#ef4444" />}
        </svg>

        {/* маркер текущего значения */}
        {bi >= 0 && (
          <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-card"
            style={{ left: `${xOf(bi)}%`, top: `${yOf(window[bi].value)}%` }} />
        )}

        {/* hover-вертикаль + тултип */}
        {active != null && (
          <>
            <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-foreground/10" style={{ left: `${xOf(active)}%` }} />
            <div className="pointer-events-none absolute z-10 -translate-y-full whitespace-nowrap rounded-xl border border-border bg-card px-3 py-2 text-left shadow-lg"
              style={{ left: `${Math.min(82, Math.max(2, xOf(active)))}%`, top: `${Math.max(12, yOf(window[active].value) - 6)}%`, transform: `translate(${xOf(active) > 60 ? "-100%" : "0"}, -8px)` }}>
              <div className="text-[11px] text-muted-foreground">{window[active].label}{window[active].forecast ? " · прогноз" : ""}</div>
              <div className="text-[13px] font-semibold text-foreground">{formatMoney(window[active].value, base)}</div>
            </div>
          </>
        )}
      </div>

      {/* подписи по оси X */}
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        {window.map((p, i) => (
          <span key={i} className={p.forecast ? "opacity-60" : ""}>{p.label}</span>
        ))}
      </div>
    </section>
  );
}
