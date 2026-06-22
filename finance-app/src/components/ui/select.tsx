"use client";

import * as React from "react";

export type SelectOption = { value: string; label: string };

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} aria-hidden>
      <path d="M2.97 5.47a.75.75 0 0 1 1.06 0L8 9.44l3.97-3.97a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 0-1.06" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" aria-hidden>
      <path d="M13.5 4.5 6.5 11.5 3 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Выпадающий выбор в едином стиле приложения (как календарь/пикер дат). */
export function Select({
  value,
  onChange,
  options,
  className = "",
  placeholder = "—",
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none transition hover:border-slate-300 focus:border-brand dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-300 dark:hover:border-white/20"
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown open={open} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 min-w-full overflow-hidden whitespace-nowrap rounded-2xl border border-border bg-card p-1 shadow-xl">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                  active ? "bg-brand font-medium text-white" : "text-slate-600 hover:bg-foreground/5 dark:text-neutral-300"
                }`}
              >
                {o.label}
                {active && <Check />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
