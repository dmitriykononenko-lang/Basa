"use client";

import * as React from "react";

export type Widget = { id: string; label: string; node: React.ReactNode };

/**
 * Сетка дашборд-виджетов с выбором видимости (составление дашборда).
 * Выбор сохраняется в localStorage.
 */
export default function DashboardWidgets({
  widgets,
  storageKey = "dashboard_widgets_hidden",
}: {
  widgets: Widget[];
  storageKey?: string;
}) {
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });

  const visible = widgets.filter((w) => !hidden.has(w.id));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          Аналитика
        </h2>
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5"
          >
            <GearIcon /> Виджеты
          </button>
          {open && (
            <div className="absolute right-0 z-40 mt-2 w-60 rounded-2xl border border-border bg-card p-2 shadow-xl">
              <p className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">Показывать на дашборде</p>
              {widgets.map((w) => (
                <label
                  key={w.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-foreground transition hover:bg-foreground/5"
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(w.id)}
                    onChange={() => toggle(w.id)}
                    className="custom-checkbox"
                  />
                  {w.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {visible.length > 0 ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          {visible.map((w) => (
            <React.Fragment key={w.id}>{w.node}</React.Fragment>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          Все виджеты скрыты. Включите их кнопкой «Виджеты».
        </p>
      )}
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
