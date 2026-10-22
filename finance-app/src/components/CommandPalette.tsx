"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Cmd = { label: string; hint?: string; href: string };

const COMMANDS: Cmd[] = [
  { label: "Дашборд", href: "/dashboard" },
  { label: "Операции", hint: "доходы, расходы, переводы", href: "/transactions" },
  { label: "Импорт выписки", hint: "загрузить банковскую выписку", href: "/transactions/import" },
  { label: "Регулярные операции", hint: "шаблоны, авто-план", href: "/recurring" },
  { label: "Контрагенты", href: "/counterparties" },
  { label: "Проекты", href: "/projects" },
  { label: "Сотрудники", href: "/employees" },
  { label: "Зарплата", hint: "реестр по месяцам", href: "/payroll" },
  { label: "Бюджеты", href: "/budgets" },
  { label: "Движение денег (ДДС)", href: "/reports/cashflow" },
  { label: "Прибыли и убытки (ОПиУ)", href: "/reports/pnl" },
  { label: "Анализ расходов", href: "/reports" },
  { label: "Задолженности", href: "/debts" },
  { label: "Платёжный календарь", href: "/calendar" },
  { label: "Счета", href: "/accounts" },
  { label: "Статьи", href: "/categories" },
  { label: "Команда", href: "/team" },
  { label: "Настройки", href: "/settings" },
];

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpen() { setOpen(true); }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) { setQ(""); setActive(0); document.body.style.overflow = "hidden"; }
    else document.body.style.overflow = "";
  }, [open]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return COMMANDS;
    return COMMANDS.filter((c) => (c.label + " " + (c.hint ?? "")).toLowerCase().includes(ql));
  }, [q]);

  function go(c: Cmd) {
    setOpen(false);
    router.push(c.href);
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop !items-start !pt-24" onClick={() => setOpen(false)} role="dialog" aria-modal="true">
      <div
        className="animate-scale-in w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 dark:bg-[#1b1d22] dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && filtered[active]) go(filtered[active]);
          }}
          placeholder="Куда перейти? Например, «опиу», «импорт», «зарплата»…"
          className="w-full border-b border-slate-100 bg-transparent px-5 py-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:border-white/[0.07] dark:text-neutral-100"
        />
        <ul className="max-h-80 overflow-auto p-2">
          {filtered.map((c, i) => (
            <li key={c.href}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(c)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  i === active ? "bg-brand/10 text-brand" : "text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-white/[0.04]"
                }`}
              >
                <span className="font-medium">{c.label}</span>
                {c.hint && <span className="ml-3 truncate text-xs text-slate-400">{c.hint}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-slate-400">Ничего не найдено</li>
          )}
        </ul>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-white/[0.07]">
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-white/[0.06]">↑↓</kbd> выбор
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-white/[0.06]">↵</kbd> перейти
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-white/[0.06]">Esc</kbd> закрыть
        </div>
      </div>
    </div>
  );
}
