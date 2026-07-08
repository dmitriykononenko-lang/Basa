"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconDashboard,
  IconTransactions,
  IconCounterparties,
  IconProjects,
  IconBudgets,
  IconReports,
  IconDebts,
  IconEmployees,
  IconCalendar,
  IconSettings,
  IconChevronDown,
  IconWallet,
  IconRepeat,
  IconTag,
  IconBook,
  IconAcademy,
  IconKey,
  IconChart,
  IconCompany,
} from "./icons";

type Item = {
  href: string;
  label: string;
  Icon: (p: { className?: string }) => JSX.Element;
  match?: string[];
  exact?: boolean;
};

type Group = { label: string; Icon: (p: { className?: string }) => JSX.Element; items: Item[] };

// Верхний уровень — самое частое и приоритетное.
const TOP: Item[] = [
  { href: "/os", label: "ОС компании", Icon: IconCompany, match: ["/os"] },
  { href: "/dashboard", label: "Дашборд", Icon: IconDashboard },
  { href: "/transactions", label: "Операции", Icon: IconTransactions },
  { href: "/metrics", label: "Показатели", Icon: IconChart, match: ["/metrics"] },
];

// Сворачиваемые группы.
const GROUPS: Group[] = [
  {
    label: "Финансы",
    Icon: IconWallet,
    items: [
      { href: "/counterparties", label: "Контрагенты", Icon: IconCounterparties },
      { href: "/agents", label: "Агенты", Icon: IconCounterparties },
      { href: "/projects", label: "Проекты", Icon: IconProjects },
      { href: "/licenses", label: "Лицензии", Icon: IconTag },
      { href: "/budgets", label: "Бюджеты", Icon: IconBudgets },
      { href: "/payroll", label: "Зарплата", Icon: IconWallet },
    ],
  },
  {
    label: "Команда",
    Icon: IconEmployees,
    items: [
      { href: "/employees", label: "Сотрудники", Icon: IconEmployees },
      { href: "/knowledge-base", label: "База знаний", Icon: IconBook, match: ["/knowledge-base"] },
      { href: "/academy", label: "Академия", Icon: IconAcademy, match: ["/academy"] },
      { href: "/vault", label: "Пароли", Icon: IconKey, match: ["/vault"] },
    ],
  },
  {
    label: "Аналитика",
    Icon: IconReports,
    items: [
      { href: "/reports/cashflow", label: "Движение средств", Icon: IconReports },
      { href: "/reports/pnl", label: "Прибыли и убытки", Icon: IconReports },
      { href: "/reports", label: "Анализ расходов", Icon: IconReports, exact: true },
      { href: "/reports/team", label: "Аналитика команды", Icon: IconReports },
      { href: "/debts", label: "Задолженности", Icon: IconDebts },
      { href: "/calendar", label: "Платёжный календарь", Icon: IconCalendar },
      { href: "/recurring", label: "Регулярные операции", Icon: IconRepeat },
    ],
  },
];

const SETTINGS: Item = {
  href: "/settings",
  label: "Настройки",
  Icon: IconSettings,
  match: ["/settings", "/accounts", "/categories", "/team"],
};

export default function Sidebar({ hidden = [] }: { hidden?: string[] }) {
  const pathname = usePathname();
  const hiddenSet = new Set(hidden);
  const visibleGroups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !hiddenSet.has(i.href)),
  })).filter((g) => g.items.length > 0);
  const topItems = TOP.filter((i) => !hiddenSet.has(i.href));

  function isActive({ href, match, exact }: Item) {
    if (exact) return pathname === href;
    return (
      pathname === href ||
      pathname.startsWith(href + "/") ||
      (match ?? []).some((m) => pathname === m || pathname.startsWith(m + "/"))
    );
  }

  const groupActive = (g: Group) => g.items.some((i) => isActive(i));

  // Открыты по умолчанию только группы с активным пунктом.
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.label, groupActive(g)]))
  );

  function cls(active: boolean) {
    return `flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium transition ${
      active
        ? "bg-neutral-900 text-white dark:bg-neutral-800"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100"
    }`;
  }

  function link(item: Item) {
    return (
      <Link key={item.href} href={item.href} className={cls(isActive(item))}>
        <item.Icon className="h-[18px] w-[18px] shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  }

  return (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {topItems.map(link)}

      {visibleGroups.map((g) => {
        const active = groupActive(g);
        const isOpen = open[g.label];
        return (
          <div key={g.label}>
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [g.label]: !o[g.label] }))}
              className={cls(active && !isOpen)}
            >
              <g.Icon className="h-[18px] w-[18px] shrink-0" />
              <span>{g.label}</span>
              <IconChevronDown className={`ml-auto h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && (
              <div className="ml-3 flex flex-col gap-1 border-l border-slate-100 pl-2 dark:border-white/[0.07]">
                {g.items.map(link)}
              </div>
            )}
          </div>
        );
      })}

      <div className="my-2 border-t border-slate-100 dark:border-white/[0.07]" />
      {link(SETTINGS)}
    </nav>
  );
}
