import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CreateTeamForm from "@/components/CreateTeamForm";
import { ROLE_LABELS } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { getCurrentTeam } from "@/lib/team";
import { buildRateMap, toBase } from "@/lib/fx";
import { IconTransactions, IconAccounts, IconReports } from "@/components/icons";

export default async function DashboardPage() {
  const current = await getCurrentTeam();

  // Нет команды — показываем онбординг
  if (!current) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-8">
        <CreateTeamForm />
      </div>
    );
  }

  const { team, role } = current;
  const supabase = await createClient();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, currency")
    .eq("team_id", team.id)
    .eq("archived", false)
    .order("created_at", { ascending: true });

  const { data: balances } = await supabase
    .from("account_balances")
    .select("account_id, currency, balance")
    .eq("team_id", team.id);

  const balanceMap = new Map(
    (balances ?? []).map((b) => [b.account_id, b.balance])
  );

  const totalByCurrency = new Map<string, number>();
  for (const b of balances ?? []) {
    totalByCurrency.set(
      b.currency,
      (totalByCurrency.get(b.currency) ?? 0) + b.balance
    );
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);

  const [{ data: monthTx }, { data: fxRows }] = await Promise.all([
    supabase
      .from("transactions")
      .select("type, amount, currency")
      .eq("team_id", team.id)
      .gte("occurred_on", monthStartStr),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  const rates = buildRateMap(fxRows ?? [], team.base_currency);
  let income = 0;
  let expense = 0;
  for (const t of monthTx ?? []) {
    const val = toBase(t.amount, t.currency, rates);
    if (t.type === "income") income += val;
    else if (t.type === "expense") expense += val;
  }

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-7">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Дашборд
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          {team.name} · ваша роль: {ROLE_LABELS[role]}
        </p>
      </header>

      {/* Быстрые действия */}
      <div className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ActionCard
          href="/transactions"
          color="accent"
          title="Добавить операцию"
          subtitle="Доход, расход или перевод"
          Icon={IconTransactions}
        />
        <ActionCard
          href="/accounts"
          color="blue"
          title="Счета"
          subtitle="Кассы и балансы"
          Icon={IconAccounts}
        />
        <ActionCard
          href="/reports"
          color="rose"
          title="Отчёты"
          subtitle="Сводки и аналитика"
          Icon={IconReports}
        />
      </div>

      {/* Метрики месяца */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric title="Доход за месяц" accent="emerald">
          {formatMoney(income, team.base_currency)}
        </Metric>
        <Metric title="Расход за месяц" accent="red">
          {formatMoney(expense, team.base_currency)}
        </Metric>
        <Metric title="Денежный поток" accent="brand">
          {formatMoney(income - expense, team.base_currency)}
        </Metric>
      </div>

      {/* Счета */}
      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          Деньги на счетах
        </h2>
        {accounts && accounts.length > 0 ? (
          <>
            <div className="mb-3 flex flex-wrap gap-3">
              {[...totalByCurrency.entries()].map(([cur, total]) => (
                <div
                  key={cur}
                  className="rounded-2xl bg-white px-5 py-3 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800"
                >
                  <div className="text-xs text-slate-400 dark:text-neutral-500">
                    Итого {cur}
                  </div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white">
                    {formatMoney(total, cur)}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map((a) => (
                <div
                  key={a.id}
                  className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800"
                >
                  <div className="text-sm font-medium text-slate-800 dark:text-neutral-200">
                    {a.name}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-neutral-500">
                    {a.currency}
                  </div>
                  <div className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
                    {formatMoney(balanceMap.get(a.id) ?? 0, a.currency)}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-800">
            Пока нет счетов. Добавьте их в разделе «Счета», чтобы видеть балансы.
          </p>
        )}
      </section>
    </div>
  );
}

const COLOR_MAP = {
  accent: "bg-accent text-white",
  blue: "bg-brand text-white",
  rose: "bg-rose-500 text-white",
};

function ActionCard({
  href,
  color,
  title,
  subtitle,
  Icon,
}: {
  href: string;
  color: keyof typeof COLOR_MAP;
  title: string;
  subtitle: string;
  Icon: (p: { className?: string }) => JSX.Element;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200/80 transition hover:ring-brand/40 dark:bg-neutral-900 dark:ring-neutral-800 dark:hover:ring-brand/50"
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${COLOR_MAP[color]}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900 dark:text-white">
          {title}
        </span>
        <span className="block text-xs text-slate-400 dark:text-neutral-500">
          {subtitle}
        </span>
      </span>
    </Link>
  );
}

function Metric({
  title,
  children,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  accent: "emerald" | "red" | "brand";
}) {
  const accentMap = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    brand: "text-brand dark:text-brand",
  };
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-2 text-2xl font-bold ${accentMap[accent]}`}>
        {children}
      </div>
    </div>
  );
}
