"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/format";

export type HeroPoint = { date: string; value: number; forecast: boolean };
export type HeroGap = { date: string; value: number } | null;

const MONTHS_SHORT = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const PERIODS: { key: string; months: number }[] = [
  { key: "3M", months: 3 },
  { key: "6M", months: 6 },
  { key: "12M", months: 12 },
];
const PAD = 10;
const DAY = 86400000;
const dayOf = (d: string) => Math.floor(new Date(d + "T00:00:00").getTime() / DAY);

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

function gapWhen(date: string, today: string): string {
  const diff = dayOf(date) - dayOf(today);
  if (diff <= 0) return "сегодня";
  if (diff === 1) return "завтра";
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export default function CashflowHero({ points, gap, base, today }: { points: HeroPoint[]; gap: HeroGap; base: string; today: string }) {
  const [period, setPeriod] = useState("6M");
  const [hover, setHover] = useState<number | null>(null);

  const tDay = dayOf(today);

  const window = useMemo(() => {
    const months = PERIODS.find((p) => p.key === period)?.months ?? 6;
    const minDay = tDay - months * 31;
    return points.filter((p) => p.forecast || dayOf(p.date) >= minDay).sort((a, b) => dayOf(a.date) - dayOf(b.date));
  }, [points, period, tDay]);

  const n = window.length;
  const xs = window.map((p) => dayOf(p.date));
  const x0 = xs[0] ?? tDay, x1 = xs[n - 1] ?? tDay + 1;
  const span = x1 - x0 || 1;
  const xOf = (i: number) => ((xs[i] - x0) / span) * 100;
  const xOfDay = (d: number) => ((d - x0) / span) * 100;

  const values = window.map((p) => p.value);
  const dataMin = Math.min(0, ...values);
  const dataMax = Math.max(...values, dataMin + 1);
  const range = dataMax - dataMin || 1;
  const lo = dataMin - range * 0.12, hi = dataMax + range * 0.12;
  const yOf = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (100 - 2 * PAD);

  const pts = window.map((p, i) => ({ x: xOf(i), y: yOf(p.value) }));
  let bi = -1;
  window.forEach((p, i) => { if (!p.forecast) bi = i; });
  if (bi < 0) bi = 0;
  const actualLine = smooth(pts.slice(0, bi + 1));
  const forecastLine = bi < n - 1 ? smooth(pts.slice(bi)) : "";
  const areaBase = 100 - PAD;
  const zeroY = yOf(0);
  const showZero = dataMin < 0;
  const current = bi >= 0 ? window[bi].value : (values[values.length - 1] ?? 0);

  // месячные подписи по оси X
  const ticks = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    const start = new Date((x0) * DAY);
    let y = start.getUTCFullYear(), m = start.getUTCMonth();
    for (let i = 0; i < 24; i++) {
      const d = Math.floor(Date.UTC(y, m, 1) / DAY);
      if (d > x1) break;
      if (d >= x0) out.push({ x: xOfDay(d), label: MONTHS_SHORT[m] });
      m++; if (m > 11) { m = 0; y++; }
    }
    return out;
  }, [x0, x1, span]);

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
                ⚠️ Кассовый разрыв {gapWhen(gap.date, today)}: {formatMoney(gap.value, base)}
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
            <button key={p.key} type="button" onClick={() => setPeriod(p.key)} data-active={period === p.key}
              className="px-4 py-1.5 font-semibold text-muted-foreground transition hover:bg-foreground/5 data-[active=true]:bg-muted data-[active=true]:text-foreground">
              {p.key}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-4 h-52 w-full"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - r.left) / r.width;
          // ближайшая точка по X
          let best = 0, bestD = Infinity;
          for (let i = 0; i < n; i++) { const dd = Math.abs(xOf(i) - ratio * 100); if (dd < bestD) { bestD = dd; best = i; } }
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}>
        <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
          <defs>
            <linearGradient id="cfh-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2f6df6" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#2f6df6" stopOpacity="0" />
            </linearGradient>
          </defs>
          {showZero && <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="currentColor" className="text-red-400/50" strokeWidth="0.5" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
          {actualLine && <path d={`${actualLine} L ${pts[bi].x} ${areaBase} L ${pts[0].x} ${areaBase} Z`} fill="url(#cfh-fill)" stroke="none" />}
          {actualLine && <path d={actualLine} fill="none" stroke="#2f6df6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          {forecastLine && <path d={forecastLine} fill="none" stroke="#2f6df6" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" vectorEffect="non-scaling-stroke" />}
          {gap && <circle cx={xOfDay(dayOf(gap.date))} cy={yOf(gap.value)} r="2.2" fill="#ef4444" />}
        </svg>

        {bi >= 0 && (
          <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-card"
            style={{ left: `${xOf(bi)}%`, top: `${yOf(window[bi].value)}%` }} />
        )}
        {gap && (
          <span className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 ring-2 ring-card" style={{ left: `${xOfDay(dayOf(gap.date))}%`, top: `${yOf(gap.value)}%`, height: 10, width: 10 }} />
        )}

        {active != null && (
          <>
            <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-foreground/10" style={{ left: `${xOf(active)}%` }} />
            <div className="pointer-events-none absolute z-10 -translate-y-full whitespace-nowrap rounded-xl border border-border bg-card px-3 py-2 text-left shadow-lg"
              style={{ left: `${Math.min(82, Math.max(2, xOf(active)))}%`, top: `${Math.max(12, yOf(window[active].value) - 6)}%`, transform: `translate(${xOf(active) > 60 ? "-100%" : "0"}, -8px)` }}>
              <div className="text-[11px] text-muted-foreground">
                {new Date(window[active].date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}{window[active].forecast ? " · прогноз" : ""}
              </div>
              <div className="text-[13px] font-semibold text-foreground">{formatMoney(window[active].value, base)}</div>
            </div>
          </>
        )}
      </div>

      <div className="relative mt-2 h-4 text-[11px] text-muted-foreground">
        {ticks.map((t, i) => (
          <span key={i} className="absolute -translate-x-1/2" style={{ left: `${Math.min(98, Math.max(2, t.x))}%` }}>{t.label}</span>
        ))}
      </div>
    </section>
  );
}
