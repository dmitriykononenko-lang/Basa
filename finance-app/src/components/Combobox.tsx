"use client";

import { useState } from "react";

export type ComboOption = { value: string; label: string; search?: string };

export default function Combobox({
  value,
  onChange,
  options,
  placeholder = "— выберите —",
  emptyLabel,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = options.find((o) => o.value === value);
  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? options.filter((o) => (o.label + " " + (o.search ?? "")).toLowerCase().includes(ql))
    : options;

  function close() {
    setOpen(false);
    setQ("");
  }

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input flex items-center justify-between gap-2 text-left"
      >
        <span className={`truncate ${selected ? "" : "text-slate-400 dark:text-neutral-500"}`}>
          {selected?.label ?? placeholder}
        </span>
        <span className="shrink-0 text-slate-400">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} />
          <div className="absolute z-30 mt-1 max-h-72 w-full min-w-[200px] overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#1b1d22]">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск…"
              className="mb-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-100"
            />
            {emptyLabel !== undefined && (
              <button
                type="button"
                onClick={() => { onChange(""); close(); }}
                className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              >
                {emptyLabel}
              </button>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); close(); }}
                className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-white/[0.06] ${
                  o.value === value ? "text-brand" : "text-slate-700 dark:text-neutral-200"
                }`}
                title={o.label}
              >
                {o.label}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2.5 py-2 text-sm text-slate-400">Ничего не найдено</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
