"use client";

import * as React from "react";
import { Activity, BarChart3, ChevronDown } from "lucide-react";
import type { ChartView } from "./metric-chart";

export type PeriodOption = { label: string; points?: number };

export function ViewToggle({
  value,
  onChange,
}: {
  value: ChartView;
  onChange: (v: ChartView) => void;
}) {
  const item = (v: ChartView, Icon: typeof Activity, label: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      aria-label={label}
      aria-pressed={value === v}
      className={`pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md transition ${
        value === v
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon size={14} strokeWidth={2.4} />
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
      {item("curve", Activity, "Кривая")}
      {item("bar", BarChart3, "Столбцы")}
    </div>
  );
}

export function PeriodSelect({
  value,
  options,
  onChange,
  accentText,
}: {
  value: string;
  options: PeriodOption[];
  onChange: (o: PeriodOption) => void;
  accentText?: string;
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

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[13px] font-medium transition hover:bg-foreground/5"
        style={{ color: accentText }}
      >
        {value}
        <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 min-w-[140px] overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg">
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left text-[13px] transition hover:bg-foreground/5 ${
                o.label === value ? "font-semibold text-foreground" : "text-muted-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
