"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconDashboard,
  IconTransactions,
  IconCounterparties,
  IconProjects,
  IconDebts,
  IconBudgets,
  IconReports,
  IconSettings,
} from "./icons";

type Item = {
  href: string;
  label: string;
  Icon: (p: { className?: string }) => JSX.Element;
  match?: string[];
};

// Повседневные разделы
const NAV: Item[] = [
  { href: "/dashboard", label: "Дашборд", Icon: IconDashboard },
  { href: "/transactions", label: "Операции", Icon: IconTransactions },
  { href: "/counterparties", label: "Контрагенты", Icon: IconCounterparties },
  { href: "/projects", label: "Проекты", Icon: IconProjects },
  { href: "/debts", label: "Долги", Icon: IconDebts },
  { href: "/budgets", label: "Бюджеты", Icon: IconBudgets },
  { href: "/reports", label: "Отчёты", Icon: IconReports },
];

// Настройки и справочники — отдельным блоком
const SETTINGS: Item = {
  href: "/settings",
  label: "Настройки",
  Icon: IconSettings,
  match: ["/settings", "/accounts", "/categories", "/team"],
};

export default function Sidebar() {
  const pathname = usePathname();

  function link({ href, label, Icon, match }: Item) {
    const active =
      pathname === href ||
      pathname.startsWith(href + "/") ||
      (match ?? []).some((m) => pathname === m || pathname.startsWith(m + "/"));
    return (
      <Link
        key={href}
        href={href}
        className={`flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium transition ${
          active
            ? "bg-neutral-900 text-white dark:bg-neutral-800"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100"
        }`}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {NAV.map(link)}
      <div className="my-2 border-t border-slate-100 dark:border-neutral-800" />
      {link(SETTINGS)}
    </nav>
  );
}
