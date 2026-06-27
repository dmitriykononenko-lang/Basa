"use client";

import { usePathname, useRouter } from "next/navigation";
import { ExpandableTabs } from "@/components/ui/expandable-tabs";
import {
  IconDashboard,
  IconTransactions,
  IconCounterparties,
  IconProjects,
  IconReports,
  IconSettings,
} from "./icons";

const ITEMS = [
  { href: "/dashboard", title: "Дашборд", icon: IconDashboard },
  { href: "/transactions", title: "Операции", icon: IconTransactions },
  { href: "/counterparties", title: "Контрагенты", icon: IconCounterparties },
  { href: "/projects", title: "Проекты", icon: IconProjects },
  { href: "/reports/cashflow", title: "Аналитика", icon: IconReports, match: "/reports" },
  { href: "/settings", title: "Настройки", icon: IconSettings, match: "/settings" },
];

export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();

  const active = ITEMS.findIndex((it) => {
    const base = it.match ?? it.href;
    return pathname === it.href || pathname === base || pathname.startsWith(base + "/");
  });

  return (
    <div className="md:hidden">
      <div className="overflow-x-auto px-3 py-2">
        <ExpandableTabs
          className="w-max"
          selected={active === -1 ? null : active}
          tabs={ITEMS.map(({ title, icon }) => ({ title, icon }))}
          onChange={(i) => {
            if (i !== null && ITEMS[i]) router.push(ITEMS[i].href);
          }}
        />
      </div>
    </div>
  );
}
