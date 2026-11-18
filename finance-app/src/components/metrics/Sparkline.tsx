"use client";

// Мини-график тренда по ряду значений (null-точки пропускаются).
export default function Sparkline({
  series,
  color,
  width = 80,
  height = 32,
}: {
  series: { period_start: string; value: number | null }[];
  color: string;
  width?: number;
  height?: number;
}) {
  const pts = series.map((p) => p.value).filter((v): v is number => v != null);
  if (pts.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = series.length > 1 ? width / (series.length - 1) : width;
  let lastX = 0, lastY = height / 2;
  const coords = series
    .map((p, i) => {
      const x = i * step;
      if (p.value == null) return null;
      lastX = x;
      lastY = height - ((p.value - min) / span) * height;
      return `${x.toFixed(1)},${lastY.toFixed(1)}`;
    })
    .filter(Boolean) as string[];
  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline points={coords.join(" ")} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.2" fill={color} />
    </svg>
  );
}
