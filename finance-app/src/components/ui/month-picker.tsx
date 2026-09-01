"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTHS_SHORT = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden>
      <path d="M2.97 5.47a.75.75 0 0 1 1.06 0L8 9.44l3.97-3.97a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 0-1.06" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}

/** Шапка-навигатор для календаря в стиле date-picker: ‹ Месяц Год ▾ › */
export function MonthPicker({ year, month }: { year: number; month: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [yearMode, setYearMode] = React.useState(false);
  const [viewYear, setViewYear] = React.useState(year);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const href = (y: number, m: number) => `/calendar?month=${y}-${String(m).padStart(2, "0")}`;
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  const go = (y: number, m: number) => {
    setOpen(false);
    router.push(href(y, m));
  };

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <Link href={href(prev.y, prev.m)} aria-label="Предыдущий месяц"
        className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5">
        ‹
      </Link>

      <button type="button" onClick={() => { setOpen((o) => !o); setYearMode(false); setViewYear(year); }}
        className="flex min-w-[150px] items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-neutral-200 dark:hover:bg-white/5">
        {MONTHS_RU[month - 1]} {year}
        <span className="text-slate-400"><ChevronDown open={open} /></span>
      </button>

      <Link href={href(next.y, next.m)} aria-label="Следующий месяц"
        className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5">
        ›
      </Link>

      {open && (
        <div className="absolute left-1/2 top-full z-40 mt-2 w-64 -translate-x-1/2 rounded-2xl border border-border bg-card p-3 shadow-xl">
          {/* Навигация по году */}
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Прошлый год" onClick={() => setViewYear((y) => y - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5">‹</button>
            <button type="button" onClick={() => setYearMode((v) => !v)}
              className="rounded-lg px-3 py-1 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:text-neutral-100 dark:hover:bg-white/5">
              {viewYear}
            </button>
            <button type="button" aria-label="Следующий год" onClick={() => setViewYear((y) => y + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5">›</button>
          </div>

          {yearMode ? (
            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: 12 }, (_, i) => viewYear - 5 + i).map((y) => (
                <button key={y} type="button" onClick={() => { setViewYear(y); setYearMode(false); }}
                  className={`h-9 rounded-lg text-[13px] transition ${
                    y === year ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5"
                  }`}>
                  {y}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {MONTHS_SHORT.map((label, i) => {
                const m = i + 1;
                const isCurrent = viewYear === year && m === month;
                return (
                  <button key={label} type="button" onClick={() => go(viewYear, m)}
                    className={`h-10 rounded-xl text-[13px] font-medium transition ${
                      isCurrent ? "bg-brand text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5"
                    }`}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
