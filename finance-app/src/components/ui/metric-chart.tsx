"use client";

import * as React from "react";

/* ── types ───────────────────────────────────────────────────── */

export type SeriesPoint = { value: number; date: string };
export type MetricAccent = "emerald" | "rose" | "blue" | "amber" | "violet" | "neutral";
export type MetricSeries = { name: string; data: SeriesPoint[]; accent?: MetricAccent };
export type ChartView = "curve" | "bar";
export type ChartSeries = { name: string; data: SeriesPoint[]; color: string };

/* ── palette ─────────────────────────────────────────────────── */

export const ACCENTS: Record<MetricAccent, { stroke: string; text: string }> = {
  emerald: { stroke: "#10b981", text: "#059669" },
  rose: { stroke: "#f43f5e", text: "#e11d48" },
  blue: { stroke: "#2f6df6", text: "#2563eb" },
  amber: { stroke: "#f59e0b", text: "#d97706" },
  violet: { stroke: "#8b5cf6", text: "#7c3aed" },
  neutral: { stroke: "#94a3b8", text: "#64748b" },
};

export const SERIES_COLORS = ["#2f6df6", "#10b981", "#f59e0b", "#8b5cf6", "#f43f5e"];

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
  return sign + String(Math.round(abs));
}

/* ── geometry ────────────────────────────────────────────────── */

const PAD_Y = 12; // % сверху/снизу, чтобы линия не липла к краям

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const d = [`M ${pts[0].x} ${pts[0].y}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
  }
  return d.join(" ");
}

/* ── component ───────────────────────────────────────────────── */

export function MetricChart({
  series,
  view,
  defaultIndex,
  valueFormatter,
  dateFormatter,
}: {
  series: ChartSeries[];
  view: ChartView;
  defaultIndex?: number;
  valueFormatter?: (v: number) => string;
  dateFormatter?: (d: string) => string;
}) {
  const primary = series[0];
  const n = primary?.data.length ?? 0;
  const [hover, setHover] = React.useState<number | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  const { min, max } = React.useMemo(() => {
    const all = series.flatMap((s) => s.data.map((d) => d.value));
    if (all.length === 0) return { min: 0, max: 1 };
    const dataMin = Math.min(...all);
    const dataMax = Math.max(...all);
    if (view === "bar") {
      // Столбцы должны расти от нуля — иначе высота вводит в заблуждение
      const lo = Math.min(0, dataMin);
      return { min: lo, max: Math.max(dataMax, lo + 1) };
    }
    // Кривая: плотный диапазон с небольшим отступом, чтобы колебания были видны,
    // а не сплющивались в полоску у края (например, остаток 6,0–6,4 млн).
    const range = dataMax - dataMin || Math.abs(dataMax) || 1;
    return { min: dataMin - range * 0.12, max: dataMax + range * 0.12 };
  }, [series, view]);

  const xOf = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const yOf = (v: number) => PAD_Y + (1 - (v - min) / (max - min || 1)) * (100 - 2 * PAD_Y);

  const fmtV = valueFormatter ?? formatCompact;
  const fmtD = dateFormatter ?? ((d: string) => d);

  const active = hover ?? Math.min(defaultIndex ?? n - 1, n - 1);

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el || n === 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))));
  }

  if (n === 0) return null;

  return (
    <div
      ref={ref}
      className="pointer-events-auto absolute inset-0"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`mc-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.20" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {view === "bar"
          ? primary.data.map((d, i) => {
              const x = xOf(i);
              const y = yOf(d.value);
              const bw = Math.max(1.5, 70 / n);
              const base = yOf(Math.max(0, min));
              return (
                <rect
                  key={i}
                  x={x - bw / 2}
                  y={Math.min(y, base)}
                  width={bw}
                  height={Math.max(0.5, Math.abs(base - y))}
                  rx="1"
                  fill={primary.color}
                  opacity={i === active ? 1 : 0.5}
                />
              );
            })
          : series.map((s, i) => {
              const pts = s.data.map((d, idx) => ({ x: xOf(idx), y: yOf(d.value) }));
              const line = smoothPath(pts);
              const areaBase = 100 - PAD_Y;
              return (
                <g key={i}>
                  <path d={`${line} L ${pts[pts.length - 1].x} ${areaBase} L ${pts[0].x} ${areaBase} Z`} fill={`url(#mc-fill-${i})`} stroke="none" />
                  <path d={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
      </svg>

      {/* Активная точка + вертикаль */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute top-0 bottom-0 w-px bg-foreground/10"
          style={{ left: `${xOf(active)}%` }}
        />
        {series.map((s, i) => (
          <span
            key={i}
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
            style={{ left: `${xOf(active)}%`, top: `${yOf(s.data[active]?.value ?? 0)}%`, background: s.color }}
          />
        ))}
      </div>

      {/* Тултип */}
      <div
        className="pointer-events-none absolute z-20 -translate-y-full whitespace-nowrap rounded-xl border border-border bg-card px-3 py-2 text-left shadow-lg"
        style={{
          left: `${Math.min(80, Math.max(2, xOf(active)))}%`,
          top: `${Math.max(14, yOf(series[0].data[active]?.value ?? 0) - 6)}%`,
          transform: `translate(${xOf(active) > 60 ? "-100%" : "0"}, -8px)`,
        }}
      >
        <div className="text-[11px] text-muted-foreground">{fmtD(primary.data[active]?.date ?? "")}</div>
        {series.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {series.length > 1 && <span className="text-muted-foreground">{s.name}:</span>}
            {fmtV(s.data[active]?.value ?? 0)}
          </div>
        ))}
      </div>
    </div>
  );
}
