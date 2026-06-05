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
} from "./icons";

type Item = {
  href: string;
  label: string;
  Icon: (p: { className?: string }) => JSX.Element;
  match?: string[];
  exact?: boolean;
};

const NAV: Item[] = [
  { href: "/dashboard", label: "Дашборд", Icon: IconDashboard },
  { href: "/transactions", label: "Операции", Icon: IconTransactions },
  { href: "/counterparties", label: "Контрагенты", Icon: IconCounterparties },
  { href: "/projects", label: "Проекты", Icon: IconProjects },
  { href: "/employees", label: "Сотрудники", Icon: IconEmployees },
  { href: "/budgets", label: "Бюджеты", Icon: IconBudgets },
];

const ANALYTICS: Item[] = [
  { href: "/reports/cashflow", label: "Движение средств", Icon: IconReports },
  { href: "/reports/pnl", label: "Прибыли и убытки", Icon: IconReports },
  { href: "/reports", label: "Анализ расходов", Icon: IconReports, exact: true },
  { href: "/debts", label: "Задолженности", Icon: IconDebts },
  { href: "/calendar", label: "Платёжный календарь", Icon: IconCalendar },
];

const SETTINGS: Item = {
  href: "/settings",
  label: "Настройки",
  Icon: IconSettings,
  match: ["/settings", "/accounts", "/categories", "/team"],
};

export default function Sidebar() {
  const pathname = usePathname();

  const analyticsActive = ANALYTICS.some(
    (i) => pathname === i.href || pathname.startsWith(i.href + "/")
  );
  const [open, setOpen] = useState(analyticsActive);

  function cls(active: boolean) {
    return `flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium transition ${
      active
        ? "bg-neutral-900 text-white dark:bg-neutral-800"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100"
    }`;
  }

  function isActive({ href, match, exact }: Item) {
    if (exact) return pathname === href;
    return (
      pathname === href ||
      pathname.startsWith(href + "/") ||
      (match ?? []).some((m) => pathname === m || pathname.startsWith(m + "/"))
    );
  }

  function link(item: Item) {
    const { href, label, Icon } = item;
    return (
      <Link key={href} href={href} className={cls(isActive(item))}>
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {NAV.map(link)}

      {/* Группа «Аналитика» */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cls(analyticsActive && !open ? true : false)}
      >
        <IconReports className="h-[18px] w-[18px] shrink-0" />
        <span>Аналитика</span>
        <IconChevronDown
          className={`ml-auto h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="ml-3 flex flex-col gap-1 border-l border-slate-100 pl-2 dark:border-white/[0.07]">
          {ANALYTICS.map((item) => (
            <Link key={item.href} href={item.href} className={cls(isActive(item))}>
              <item.Icon className="h-[18px] w-[18px] shrink-0" />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="my-2 border-t border-slate-100 dark:border-white/[0.07]" />
      {link(SETTINGS)}
    </nav>
  );
}
