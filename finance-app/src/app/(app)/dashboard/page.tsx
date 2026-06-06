import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CreateTeamForm from "@/components/CreateTeamForm";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { getCurrentTeam } from "@/lib/team";
import { buildRateMap, toBase } from "@/lib/fx";
import AcceptInviteButton from "@/components/AcceptInviteButton";
import { IconTransactions, IconAccounts, IconReports } from "@/components/icons";
import TrendChart, { type TrendPoint } from "@/components/TrendChart";

const MONTHS_SHORT = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

export default async function DashboardPage() {
  const current = await getCurrentTeam();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Приглашения, ожидающие принятия текущим пользователем
  const { data: myInvites } = await supabase
    .from("invites")
    .select("id, role, team:teams(name)")
    .eq("status", "pending")
    .eq("email", (user?.email ?? "").toLowerCase());

  const invites = (myInvites ?? []) as unknown as {
    id: string;
    role: AppRole;
    team: { name: string } | null;
  }[];

  const InvitesBlock =
    invites.length > 0 ? (
      <div className="mb-6 space-y-2">
        {invites.map((inv) => (
          <div
            key={inv.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-brand/5 px-5 py-4 ring-1 ring-brand/20"
          >
            <div className="text-sm text-slate-700 dark:text-neutral-200">
              Вас пригласили в команду{" "}
              <b>{inv.team?.name ?? "—"}</b> как{" "}
              {ROLE_LABELS[inv.role]}
            </div>
            <AcceptInviteButton inviteId={inv.id} />
          </div>
        ))}
      </div>
    ) : null;

  // Нет команды — показываем приглашения и/или онбординг
  if (!current) {
    return (
      <div className="mx-auto max-w-2xl p-6 sm:p-8">
        {InvitesBlock}
        <div className="flex justify-center">
          <CreateTeamForm />
        </div>
      </div>
    );
  }

  const { team, role } = current;

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
      .eq("status", "actual")
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

  // Просроченные долги
  const today = new Date().toISOString().slice(0, 10);
  const { data: overdue } = await supabase
    .from("obligation_balances")
    .select("outstanding, currency, due_date")
    .eq("team_id", team.id)
    .gt("outstanding", 0)
    .lt("due_date", today);

  let overdueAmount = 0;
  const overdueCount = (overdue ?? []).length;
  for (const o of overdue ?? []) {
    overdueAmount += toBase(o.outstanding, o.currency, rates);
  }

  // Превышенные бюджеты
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
  const [{ data: budgets }, { data: yearExp }] = await Promise.all([
    supabase
      .from("budgets")
      .select("amount, period, period_start, category_id")
      .eq("team_id", team.id),
    supabase
      .from("transactions")
      .select("category_id, amount, currency, occurred_on")
      .eq("team_id", team.id)
      .eq("type", "expense")
      .eq("status", "actual")
      .gte("occurred_on", yearStart),
  ]);

  let overBudgets = 0;
  for (const b of budgets ?? []) {
    const start = b.period_start;
    const end = new Date(b.period_start);
    if (b.period === "year") end.setFullYear(end.getFullYear() + 1);
    else if (b.period === "quarter") end.setMonth(end.getMonth() + 3);
    else end.setMonth(end.getMonth() + 1);
    const endStr = end.toISOString().slice(0, 10);
    let spent = 0;
    for (const t of yearExp ?? []) {
      if (t.category_id === b.category_id && t.occurred_on >= start && t.occurred_on < endStr) {
        spent += toBase(t.amount, t.currency, rates);
      }
    }
    if (spent > b.amount) overBudgets++;
  }

  // ── Динамика остатка на счетах: факт + прогноз кассового разрыва ──
  const curY = new Date().getFullYear();
  const curM = new Date().getMonth();
  const curKey = curY * 12 + curM;
  const PAST = 5; // месяцев истории до текущего
  const FUT = 3; // месяцев прогноза вперёд
  const sixStart = new Date(curY, curM - PAST, 1).toISOString().slice(0, 10);

  const currentBalance = (balances ?? []).reduce(
    (s, b) => s + toBase(b.balance, b.currency, rates),
    0
  );

  const [{ data: histTx }, { data: planTx }, { data: futureObl }] = await Promise.all([
    supabase
      .from("transactions")
      .select("type, amount, currency, occurred_on")
      .eq("team_id", team.id)
      .eq("status", "actual")
      .gte("occurred_on", sixStart),
    supabase
      .from("transactions")
      .select("type, amount, currency, occurred_on")
      .eq("team_id", team.id)
      .eq("status", "planned")
      .gte("occurred_on", today),
    supabase
      .from("obligation_balances")
      .select("outstanding, currency, due_date")
      .eq("team_id", team.id)
      .gt("outstanding", 0)
      .gte("due_date", today),
  ]);

  // Чистый поток по месяцам (переводы между своими счетами не меняют общий остаток)
  const factNet = new Map<number, number>();
  for (const t of histTx ?? []) {
    if (t.type === "transfer") continue;
    const d = new Date(t.occurred_on);
    const key = d.getFullYear() * 12 + d.getMonth();
    const v = toBase(t.amount, t.currency, rates);
    factNet.set(key, (factNet.get(key) ?? 0) + (t.type === "income" ? v : -v));
  }

  const fcNet = new Map<number, number>();
  for (const t of planTx ?? []) {
    if (t.type === "transfer") continue;
    const d = new Date(t.occurred_on);
    const key = d.getFullYear() * 12 + d.getMonth();
    const v = toBase(t.amount, t.currency, rates);
    fcNet.set(key, (fcNet.get(key) ?? 0) + (t.type === "income" ? v : -v));
  }
  for (const o of futureObl ?? []) {
    const d = new Date(o.due_date);
    const key = d.getFullYear() * 12 + d.getMonth();
    fcNet.set(key, (fcNet.get(key) ?? 0) - toBase(o.outstanding, o.currency, rates));
  }

  // Закрытие месяца: факт — обратным ходом от текущего баланса
  const closeByKey = new Map<number, number>();
  closeByKey.set(curKey, currentBalance);
  for (let k = 1; k <= PAST; k++) {
    const key = curKey - k;
    closeByKey.set(key, closeByKey.get(key + 1)! - (factNet.get(key + 1) ?? 0));
  }
  // Прогноз — вперёд (учитываем плановые операции остатка текущего месяца)
  let running = currentBalance + (fcNet.get(curKey) ?? 0);
  for (let k = 1; k <= FUT; k++) {
    const key = curKey + k;
    running += fcNet.get(key) ?? 0;
    closeByKey.set(key, running);
  }

  const trendPoints: TrendPoint[] = [];
  for (let key = curKey - PAST; key <= curKey + FUT; key++) {
    const m = ((key % 12) + 12) % 12;
    trendPoints.push({
      label: MONTHS_SHORT[m],
      value: closeByKey.get(key) ?? 0,
      forecast: key > curKey,
    });
  }

  // Кассовый разрыв: минимальная прогнозная точка ниже нуля
  let gapValue = 0;
  let gapLabel = "";
  for (const p of trendPoints) {
    if (p.forecast && p.value < gapValue) {
      gapValue = p.value;
      gapLabel = p.label;
    }
  }
  const hasGap = gapValue < 0;
  const showTrend = (accounts?.length ?? 0) > 0;

  return (
    <div className="p-6 sm:p-8">
      {InvitesBlock}
      {overdueCount > 0 && (
        <Link
          href="/debts"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-amber-50 px-5 py-4 ring-1 ring-amber-200 transition hover:ring-amber-300 dark:bg-amber-950/30 dark:ring-amber-900/40"
        >
          <span className="text-sm text-amber-800 dark:text-amber-200">
            ⚠️ Просрочено обязательств: <b>{overdueCount}</b> на сумму{" "}
            <b>{formatMoney(overdueAmount, team.base_currency)}</b>
          </span>
          <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
            Открыть долги →
          </span>
        </Link>
      )}
      {overBudgets > 0 && (
        <Link
          href="/budgets"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-red-50 px-5 py-4 ring-1 ring-red-200 transition hover:ring-red-300 dark:bg-red-950/30 dark:ring-red-900/40"
        >
          <span className="text-sm text-red-800 dark:text-red-200">
            🚨 Превышено бюджетов: <b>{overBudgets}</b>
          </span>
          <span className="text-sm font-medium text-red-700 dark:text-red-300">
            Открыть бюджеты →
          </span>
        </Link>
      )}
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

      {/* Динамика остатка + прогноз */}
      {showTrend && (
        <section className="mt-8 rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Динамика остатка на счетах
              </h2>
              <p className="text-xs text-slate-400 dark:text-neutral-500">
                Факт за {PAST} мес. · пунктир — прогноз по плановым операциям и обязательствам ({team.base_currency})
              </p>
            </div>
            {hasGap ? (
              <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/40">
                ⚠️ Кассовый разрыв возможен в {gapLabel}: {formatMoney(gapValue, team.base_currency)}
              </span>
            ) : (
              <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/40">
                Разрывов не прогнозируется
              </span>
            )}
          </div>
          <TrendChart points={trendPoints} base={team.base_currency} />
        </section>
      )}

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
                  className="rounded-2xl bg-white px-5 py-3 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]"
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
                  className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]"
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
          <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
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
      className="group flex items-center gap-3 rounded-3xl bg-white p-4 ring-1 ring-slate-200/80 transition hover:ring-brand/40 dark:bg-[#15171c] dark:ring-white/[0.07] dark:hover:ring-brand/50"
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
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-2 text-2xl font-bold ${accentMap[accent]}`}>
        {children}
      </div>
    </div>
  );
}
