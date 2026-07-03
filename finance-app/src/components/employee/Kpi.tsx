import type { ReactNode } from "react";

// KPI-тайл карточки сотрудника: заголовок, значение, опц. прогресс-бар и опц. подпись/чипы.
export default function Kpi({
  title,
  value,
  accent,
  progress,
  sub,
  hint,
}: {
  title: string;
  value: string;
  accent?: "amber" | "emerald" | "brand";
  progress?: number; // 0..1 — доля «закрыто»
  sub?: ReactNode; // чипы валют / доп. строка под значением
  hint?: string;
}) {
  const color =
    accent === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : accent === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : accent === "brand"
      ? "text-brand"
      : "text-slate-900 dark:text-white";
  const pct = progress == null ? null : Math.max(0, Math.min(1, progress));
  return (
    <div className="surface p-5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
        {pct != null && (
          <div className="text-xs font-medium text-slate-400 dark:text-neutral-500">{Math.round(pct * 100)}%</div>
        )}
      </div>
      <div className={`mt-2 text-lg font-bold ${color}`}>{value}</div>
      {pct != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct * 100}%` }} />
        </div>
      )}
      {sub && <div className="mt-2 flex flex-wrap gap-1.5">{sub}</div>}
      {hint && <div className="mt-2 text-xs text-slate-400 dark:text-neutral-500">{hint}</div>}
    </div>
  );
}
