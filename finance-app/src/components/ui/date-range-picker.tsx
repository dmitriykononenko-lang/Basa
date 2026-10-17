"use client";

import * as React from "react";

const WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtRu = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
};

export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = "Выберите период",
}: {
  from?: string;
  to?: string;
  onChange: (from: string, to: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [start, setStart] = React.useState<string | null>(from || null);
  const [end, setEnd] = React.useState<string | null>(to || null);
  const init = from ? new Date(from) : new Date();
  const [viewY, setViewY] = React.useState(init.getFullYear());
  const [viewM, setViewM] = React.useState(init.getMonth()); // 0-11
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => { setStart(from || null); setEnd(to || null); }, [from, to]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const firstDow = (new Date(viewY, viewM, 1).getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => new Date(viewY, viewM, 1 + (i - firstDow)));

  const pick = (d: Date) => {
    const s = iso(d);
    if (!start || (start && end)) {
      setStart(s);
      setEnd(null);
      return;
    }
    // start есть, end нет
    if (s < start) {
      setEnd(start);
      setStart(s);
      onChange(s, start);
    } else {
      setEnd(s);
      onChange(start, s);
    }
    setOpen(false);
  };

  const move = (delta: number) => {
    const d = new Date(viewY, viewM + delta, 1);
    setViewY(d.getFullYear());
    setViewM(d.getMonth());
  };

  const label =
    start && end ? `${fmtRu(start)} — ${fmtRu(end)}` : start ? `${fmtRu(start)} — …` : placeholder;

  const navBtn = "flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5";

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none transition focus:border-brand dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-300"
      >
        <CalendarIcon />
        <span className={start ? "" : "text-slate-400 dark:text-neutral-500"}>{label}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[300px] rounded-2xl border border-border bg-card p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Предыдущий месяц" className={navBtn} onClick={() => move(-1)}>‹</button>
            <span className="text-sm font-semibold text-slate-800 dark:text-neutral-100">{MONTHS[viewM]} {viewY}</span>
            <button type="button" aria-label="Следующий месяц" className={navBtn} onClick={() => move(1)}>›</button>
          </div>

          <div className="mb-1 grid grid-cols-7">
            {WEEK.map((w) => (
              <div key={w} className="py-1 text-center text-[11px] font-medium text-muted-foreground">{w}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1">
            {cells.map((d, i) => {
              const s = iso(d);
              const outside = d.getMonth() !== viewM;
              const isStart = s === start;
              const isEnd = s === end;
              const inRange = start && end && s > start && s < end;
              const endpoint = isStart || isEnd;
              return (
                <div key={i} className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => pick(d)}
                    className={[
                      "flex h-9 w-9 items-center justify-center rounded-full text-[13px] transition",
                      endpoint ? "bg-brand font-semibold text-white" : "",
                      inRange ? "rounded-lg bg-brand/15 text-brand" : "",
                      !endpoint && !inRange ? (outside ? "text-slate-300 hover:bg-slate-100 dark:text-neutral-600 dark:hover:bg-white/5" : "text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5") : "",
                    ].join(" ")}
                  >
                    {d.getDate()}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <span className="text-xs text-muted-foreground">
              {start && end ? `${fmtRu(start)} — ${fmtRu(end)}` : start ? "Выберите конец периода" : "Выберите начало"}
            </span>
            <button
              type="button"
              onClick={() => { setStart(null); setEnd(null); onChange("", ""); }}
              className="rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:text-brand"
            >
              Сбросить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 13 14" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path clipRule="evenodd" fillRule="evenodd" d="M3.75 4.5A.75.75 0 0 1 3 3.75v-.748a1.5 1.5 0 0 0-1.5 1.5v1h10v-1a1.5 1.5 0 0 0-1.5-1.5v.75a.75.75 0 1 1-1.5 0v-.75h-4v.747a.75.75 0 0 1-.75.75ZM8.5 1.501h-4V.75a.75.75 0 0 0-1.5 0v.752a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3v-6a3 3 0 0 0-3-3v-.75a.75.75 0 0 0-1.5 0v.75Zm-7 5.5v3.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5v-3.5h-10Z" />
    </svg>
  );
}
