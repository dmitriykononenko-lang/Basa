import Link from "next/link";
import { IconAccounts, IconTag, IconTeam } from "@/components/icons";

type Card = {
  href: string;
  title: string;
  desc: string;
  Icon: (p: { className?: string }) => JSX.Element;
  color: string;
};

const GROUPS: { title: string; items: Card[] }[] = [
  {
    title: "Ваш бизнес",
    items: [
      {
        href: "/accounts",
        title: "Счета",
        desc: "Кассы и счета, балансы, архив",
        Icon: IconAccounts,
        color: "bg-brand text-white",
      },
      {
        href: "/categories",
        title: "Статьи",
        desc: "Статьи доходов и расходов",
        Icon: IconTag,
        color: "bg-accent text-white",
      },
    ],
  },
  {
    title: "Команда",
    items: [
      {
        href: "/team",
        title: "Участники и роли",
        desc: "Приглашения, права доступа",
        Icon: IconTeam,
        color: "bg-rose-500 text-white",
      },
    ],
  },
];

export default function SettingsPage() {
  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Настройки
        </h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Справочники и параметры рабочего пространства
        </p>
      </header>

      <div className="space-y-8">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
              {g.title}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  className="group flex items-center gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200/80 transition hover:ring-brand/40 dark:bg-[#15171c] dark:ring-white/[0.07] dark:hover:ring-brand/50"
                >
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${c.color}`}>
                    <c.Icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                      {c.title}
                    </span>
                    <span className="block text-xs text-slate-400 dark:text-neutral-500">
                      {c.desc}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
