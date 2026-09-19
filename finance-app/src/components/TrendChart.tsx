"use client";

import { formatMoney } from "@/lib/format";

export type TrendPoint = { label: string; value: number; forecast?: boolean };

function smooth(p: { x: number; y: number }[]): string {
  if (p.length === 0) return "";
  if (p.length === 1) return `M ${p[0].x},${p[0].y}`;
  let d = `M ${p[0].x},${p[0].y}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

export default function TrendChart({ points, base }: { points: TrendPoint[]; base: string }) {
  if (points.length < 2) return null;
  const W = 1000, H = 260, padX = 28, padT = 24, padB = 30;
  const vals = points.map((p) => p.value);
  const min = Math.min(0, ...vals);
  const max = Math.max(...vals, 1);
  const span = max - min || 1;
  const x = (i: number) => padX + (i * (W - 2 * padX)) / (points.length - 1);
  const y = (v: number) => H - padB - ((v - min) / span) * (H - padB - padT);
  const pts = points.map((p, i) => ({ x: x(i), y: y(p.value) }));

  const split = points.findIndex((p) => p.forecast);
  const hasForecast = split > 0;
  const factPts = hasForecast ? pts.slice(0, split) : pts;
  const forePts = hasForecast ? pts.slice(split - 1) : [];
  const gap = points.some((p) => p.forecast && p.value < 0);
  const zeroY = y(0);

  const fullLine = smooth(pts);
  const area = `${fullLine} L ${pts[pts.length - 1].x},${H - padB} L ${pts[0].x},${H - padB} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 220 }}>
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2f6df6" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#2f6df6" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* нулевая линия / зона кассового разрыва */}
      {min < 0 && (
        <>
          <rect x={padX} y={zeroY} width={W - 2 * padX} height={H - padB - zeroY} fill="#ef4444" opacity="0.07" />
          <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="#ef4444" strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />
        </>
      )}

      <path d={area} fill="url(#trendFill)" />
      <path d={smooth(factPts)} fill="none" stroke="#2f6df6" strokeWidth="2.5" strokeLinecap="round" />
      {hasForecast && (
        <path d={smooth(forePts)} fill="none" stroke={gap ? "#ef4444" : "#2f6df6"} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 5" opacity="0.85" />
      )}

      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={points[i].forecast ? 3 : 3.5}
            fill={points[i].value < 0 ? "#ef4444" : points[i].forecast ? "#fff" : "#2f6df6"}
            stroke={points[i].value < 0 ? "#ef4444" : "#2f6df6"} strokeWidth="2" />
          <text x={p.x} y={H - 8} textAnchor="middle" className="fill-slate-400" fontSize="11">{points[i].label}</text>
          <title>{`${points[i].label}: ${formatMoney(points[i].value, base)}${points[i].forecast ? " (прогноз)" : ""}`}</title>
        </g>
      ))}
    </svg>
  );
}
