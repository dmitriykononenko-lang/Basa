"use client";

import * as React from "react";

export type SelectOption = { value: string; label: string; disabled?: boolean };

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

/**
 * Выпадающий выбор в едином стиле приложения (как календарь/пикер дат).
 * Поддерживает контролируемый режим (value+onChange) и форменный (name+defaultValue).
 */
export function Select({
  value,
  defaultValue,
  onChange,
  options,
  name,
  className = "",
  placeholder = "—",
  variant = "input",
  disabled = false,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  options: SelectOption[];
  /** Если задан — рендерит скрытый input для отправки в форме. */
  name?: string;
  className?: string;
  placeholder?: string;
  /** input — прямоугольное поле формы; pill — скруглённая «таблетка» фильтра. */
  variant?: "input" | "pill";
  disabled?: boolean;
}) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState(defaultValue ?? "");
  const current = isControlled ? value! : internal;
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

  const set = (v: string) => {
    if (!isControlled) setInternal(v);
    onChange?.(v);
    setOpen(false);
  };

  const selected = options.find((o) => o.value === current);

  const trigger =
    variant === "pill"
      ? "flex w-full items-center justify-between gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none transition hover:border-slate-300 focus:border-brand disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-300 dark:hover:border-white/20"
      : "flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-100";

  return (
    <div ref={ref} className={`relative ${variant === "pill" ? "inline-block" : "block"} ${className}`}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={trigger}>
        <span className={`truncate ${selected ? "" : "text-slate-400 dark:text-neutral-500"}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown open={open} />
      </button>
      {name && <input type="hidden" name={name} value={current} />}

      {open && !disabled && (
        <div className="absolute left-0 top-full z-40 mt-2 max-h-72 min-w-full overflow-auto whitespace-nowrap rounded-2xl border border-border bg-card p-1 shadow-xl">
          {options.map((o) => {
            const active = o.value === current;
            return (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                onClick={() => set(o.value)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition disabled:opacity-40 ${
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
