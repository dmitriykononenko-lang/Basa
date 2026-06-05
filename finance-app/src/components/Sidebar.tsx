"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: { href: string; label: string; soon?: boolean }[] = [
  { href: "/dashboard", label: "Дашборд" },
  { href: "/transactions", label: "Операции" },
  { href: "/accounts", label: "Счета" },
  { href: "/counterparties", label: "Контрагенты" },
  { href: "/projects", label: "Проекты" },
  { href: "/debts", label: "Долги" },
  { href: "/budgets", label: "Бюджеты" },
  { href: "/reports", label: "Отчёты" },
  { href: "/team", label: "Команда" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-3">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-brand/10 text-brand"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <span>{item.label}</span>
            {item.soon && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">
                скоро
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
