"use client";

import * as React from "react";

export type Widget = { id: string; label: string; node: React.ReactNode; span?: 1 | 2 };

/**
 * Сетка дашборд-виджетов: выбор видимости + перетаскивание (порядок).
 * Видимость и порядок сохраняются в localStorage.
 */
export default function DashboardWidgets({
  widgets,
  storageKey = "dashboard_widgets",
  defaultHidden = [],
}: {
  widgets: Widget[];
  storageKey?: string;
  /** id виджетов, скрытых при первом открытии (пока пользователь не настроил). */
  defaultHidden?: string[];
}) {
  const allIds = React.useMemo(() => widgets.map((w) => w.id), [widgets]);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [order, setOrder] = React.useState<string[]>(allIds);
  const [open, setOpen] = React.useState(false);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  // Загрузка сохранённого состояния
  React.useEffect(() => {
    try {
      const rawH = localStorage.getItem(`${storageKey}_hidden`);
      setHidden(new Set(rawH ? (JSON.parse(rawH) as string[]) : defaultHidden));
      const rawO = localStorage.getItem(`${storageKey}_order`);
      const saved: string[] = rawO ? JSON.parse(rawO) : [];
      // Сохранённый порядок + новые виджеты в конец, без устаревших id
      const merged = [...saved.filter((id) => allIds.includes(id)), ...allIds.filter((id) => !saved.includes(id))];
      setOrder(merged);
    } catch {
      /* ignore */
    }
  }, [storageKey, allIds]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const persistHidden = (next: Set<string>) => {
    try { localStorage.setItem(`${storageKey}_hidden`, JSON.stringify([...next])); } catch { /* ignore */ }
  };
  const persistOrder = (next: string[]) => {
    try { localStorage.setItem(`${storageKey}_order`, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistHidden(next);
      return next;
    });

  const reorder = (overId: string) => {
    if (!dragId || dragId === overId) return;
    setOrder((prev) => {
      const next = prev.filter((id) => id !== dragId);
      const idx = next.indexOf(overId);
      next.splice(idx, 0, dragId);
      persistOrder(next);
      return next;
    });
  };

  const byId = new Map(widgets.map((w) => [w.id, w]));
  const visible = order.filter((id) => byId.has(id) && !hidden.has(id));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Аналитика</h2>
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5"
          >
            <GearIcon /> Виджеты
          </button>
          {open && (
            <div className="absolute right-0 z-40 mt-2 w-64 rounded-2xl border border-border bg-card p-2 shadow-xl">
              <p className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">Показывать на дашборде</p>
              {order.map((id) => {
                const w = byId.get(id);
                if (!w) return null;
                return (
                  <label key={id} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-foreground transition hover:bg-foreground/5">
                    <input type="checkbox" checked={!hidden.has(id)} onChange={() => toggle(id)} className="custom-checkbox" />
                    {w.label}
                  </label>
                );
              })}
              <p className="px-2 pt-1.5 text-[11px] text-muted-foreground">Перетаскивайте карточки за ручку ⠿, чтобы менять порядок.</p>
            </div>
          )}
        </div>
      </div>

      {visible.length > 0 ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          {visible.map((id) => {
            const w = byId.get(id)!;
            return (
              <div
                key={id}
                onDragOver={(e) => { e.preventDefault(); reorder(id); }}
                onDrop={(e) => e.preventDefault()}
                className={`group relative transition ${w.span === 2 ? "lg:col-span-2" : ""} ${dragId === id ? "opacity-50" : ""}`}
              >
                <button
                  type="button"
                  aria-label="Перетащить"
                  draggable
                  onDragStart={() => setDragId(id)}
                  onDragEnd={() => setDragId(null)}
                  className="absolute right-3 top-3 z-20 cursor-grab rounded-lg p-1 text-slate-300 opacity-0 transition hover:bg-foreground/5 hover:text-slate-500 active:cursor-grabbing group-hover:opacity-100 dark:text-neutral-600"
                >
                  <GripIcon />
                </button>
                {w.node}
              </div>
            );
          })}
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

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}
