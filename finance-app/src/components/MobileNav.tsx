"use client";

import { usePathname, useRouter } from "next/navigation";
import { ExpandableTabs } from "@/components/ui/expandable-tabs";
import {
  IconDashboard,
  IconTransactions,
  IconCounterparties,
  IconProjects,
  IconEmployees,
  IconChart,
  IconBook,
  IconAcademy,
  IconKey,
  IconBudgets,
  IconReports,
  IconSettings,
} from "./icons";

const ITEMS = [
  { href: "/dashboard", title: "Дашборд", icon: IconDashboard },
  { href: "/transactions", title: "Операции", icon: IconTransactions },
  { href: "/counterparties", title: "Контрагенты", icon: IconCounterparties },
  { href: "/projects", title: "Проекты", icon: IconProjects },
  { href: "/employees", title: "Сотрудники", icon: IconEmployees, match: "/employees" },
  { href: "/metrics", title: "Показатели", icon: IconChart, match: "/metrics" },
  { href: "/budgets", title: "Бюджеты", icon: IconBudgets },
  { href: "/knowledge-base", title: "База знаний", icon: IconBook, match: "/knowledge-base" },
  { href: "/academy", title: "Академия", icon: IconAcademy, match: "/academy" },
  { href: "/vault", title: "Пароли", icon: IconKey, match: "/vault" },
  { href: "/reports/cashflow", title: "Аналитика", icon: IconReports, match: "/reports" },
  { href: "/settings", title: "Настройки", icon: IconSettings, match: "/settings" },
];

export default function MobileNav({ hidden = [] }: { hidden?: string[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const hiddenSet = new Set(hidden);
  const items = ITEMS.filter((it) => !hiddenSet.has(it.href));

  const active = items.findIndex((it) => {
    const base = it.match ?? it.href;
    return pathname === it.href || pathname === base || pathname.startsWith(base + "/");
  });

  return (
    <div className="md:hidden">
      <div className="overflow-x-auto px-3 py-2">
        <ExpandableTabs
          className="w-max"
          selected={active === -1 ? null : active}
          tabs={items.map(({ title, icon }) => ({ title, icon }))}
          onChange={(i) => {
            if (i !== null && items[i]) router.push(items[i].href);
          }}
        />
      </div>
    </div>
  );
}
