import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CreateTeamForm from "@/components/CreateTeamForm";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { getCurrentTeam } from "@/lib/team";
import { buildRateMap, toBase } from "@/lib/fx";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { fetchCbrRates, type CbrRates } from "@/lib/cbr";
import AcceptInviteButton from "@/components/AcceptInviteButton";
import { IconTransactions, IconAccounts, IconReports } from "@/components/icons";
import { type TrendPoint } from "@/components/TrendChart";
import DashboardCharts from "@/components/DashboardCharts";
import PlannedReview from "@/components/PlannedReview";

const MONTHS_SHORT = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

type InviteRow = { id: string; role: AppRole; team: { name: string } | null };

export default async function DashboardPage() {
  const supabase = await createClient();

  // Команда и пользователь независимы — тянем параллельно
  const [current, { data: { user } }] = await Promise.all([
    getCurrentTeam(),
    supabase.auth.getUser(),
  ]);
  const email = (user?.email ?? "").toLowerCase();

  // Нет команды — лёгкая ветка: только приглашения + онбординг
  if (!current) {
    const { data: myInvites } = await supabase
      .from("invites")
      .select("id, role, team:teams(name)")
      .eq("status", "pending")
      .eq("email", email);
    const invites = (myInvites ?? []) as unknown as InviteRow[];
    return (
      <div className="mx-auto max-w-2xl p-6 sm:p-8">
        <InvitesBlock invites={invites} />
        <div className="flex justify-center">
          <CreateTeamForm />
        </div>
      </div>
    );
  }

  const { team, role } = current;

  // ── Даты для запросов (сервер Vercel работает в UTC) ──
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const curKey = curY * 12 + curM;
  const PAST = 5; // месяцев истории до текущего
  const FUT = 3; // месяцев прогноза вперёд
  const today = now.toISOString().slice(0, 10);
  const monthStartStr = new Date(curY, curM, 1).toISOString().slice(0, 10);
  const monthEndStr = new Date(curY, curM + 1, 0).toISOString().slice(0, 10);
  const yearStart = new Date(curY, 0, 1).toISOString().slice(0, 10);
  const sixStart = new Date(curY, curM - PAST, 1).toISOString().slice(0, 10);

  // ── Все запросы дашборда одним параллельным батчем ──
  const [
    { data: myInvites },
    { data: accounts },
    { data: balances },
    { count: txCount },
    { count: importCount },
    { count: plannedCount },
    { data: monthTx },
    { data: fxRows },
    cbr,
    { data: overdue },
    { data: budgets },
    { data: planTx },
    { data: futureObl },
  ] = await Promise.all([
    supabase.from("invites").select("id, role, team:teams(name)").eq("status", "pending").eq("email", email),
    supabase.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false).order("created_at", { ascending: true }),
    supabase.from("account_balances").select("account_id, currency, balance").eq("team_id", team.id),
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("team_id", team.id),
    supabase.from("import_batches").select("id", { count: "exact", head: true }).eq("team_id", team.id),
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("team_id", team.id).eq("status", "planned"),
    supabase.from("transactions").select("type, amount, currency, status").eq("team_id", team.id).gte("occurred_on", monthStartStr).lte("occurred_on", monthEndStr),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
    team.base_currency === "RUB" ? fetchCbrRates() : Promise.resolve<CbrRates>({ rates: {}, date: null }),
    supabase.from("obligation_balances").select("outstanding, currency, due_date").eq("team_id", team.id).gt("outstanding", 0).lt("due_date", today),
    supabase.from("budgets").select("amount, currency, period, period_start, category_id").eq("team_id", team.id),
    supabase.from("transactions").select("type, amount, currency, occurred_on, account_id, transfer_account_id").eq("team_id", team.id).eq("status", "planned").gte("occurred_on", today),
    supabase.from("obligation_balances").select("outstanding, currency, due_date").eq("team_id", team.id).gt("outstanding", 0).gte("due_date", today),
  ]);

  // Годовые/полугодовые выборки — постранично (операций за период может быть >1000)
  const yearExp = await fetchAllRows((from, to) =>
    supabase.from("transactions").select("category_id, amount, currency, occurred_on").eq("team_id", team.id).eq("type", "expense").eq("status", "actual").gte("occurred_on", yearStart).order("occurred_on", { ascending: true }).range(from, to)
  );
  const histTx = await fetchAllRows((from, to) =>
    supabase.from("transactions").select("type, amount, currency, occurred_on").eq("team_id", team.id).eq("status", "actual").gte("occurred_on", sixStart).order("occurred_on", { ascending: true }).range(from, to)
  );

  const invites = (myInvites ?? []) as unknown as InviteRow[];

  // Онбординг: сколько шагов пройдено
  const onboarding = [
    { done: (accounts?.length ?? 0) > 0, label: "Создайте счёт", href: "/accounts" },
    { done: (txCount ?? 0) > 0, label: "Добавьте первую операцию", href: "/transactions" },
    { done: (importCount ?? 0) > 0, label: "Импортируйте банковскую выписку", href: "/transactions/import" },
  ];
  const onboardingDone = onboarding.every((s) => s.done);

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

  const rates = buildRateMap(fxRows ?? [], team.base_currency);
  // Сверка с курсом ЦБ РФ на сегодня: для валют без ручного курса (например USD/USDT)
  // подставляем официальный курс ЦБ, чтобы доход в валюте отображался в рублях.
  for (const [cur, r] of Object.entries(cbr.rates)) {
    if (rates[cur] === undefined) rates[cur] = r;
  }
  // Валюты операций/счетов без какого-либо курса (ни ручного, ни ЦБ) — считаются 1:1
  const usedCurrencies = new Set<string>([
    ...(accounts ?? []).map((a) => a.currency),
    ...(monthTx ?? []).map((t) => t.currency),
  ]);
  const unconverted = [...usedCurrencies].filter(
    (c) => c !== team.base_currency && rates[c] === undefined
  );
  // Курс USD по ЦБ для подписи-сверки (USDT котируется как USD)
  const cbrUsd = cbr.rates.USD;

  let income = 0;
  let expense = 0;
  let plannedIncome = 0;
  let plannedExpense = 0;
  for (const t of monthTx ?? []) {
    const val = toBase(t.amount, t.currency, rates);
    if (t.status === "planned") {
      if (t.type === "income") plannedIncome += val;
      else if (t.type === "expense") plannedExpense += val;
    } else {
      if (t.type === "income") income += val;
      else if (t.type === "expense") expense += val;
    }
  }

  // Просроченные долги
  let overdueAmount = 0;
  const overdueCount = (overdue ?? []).length;
  for (const o of overdue ?? []) {
    overdueAmount += toBase(o.outstanding, o.currency, rates);
  }

  // Превышенные бюджеты
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
    if (spent > toBase(b.amount, b.currency, rates)) overBudgets++;
  }

  // ── Динамика остатка на счетах: факт + прогноз кассового разрыва ──
  const currentBalance = (balances ?? []).reduce(
    (s, b) => s + toBase(b.balance, b.currency, rates),
    0
  );

  // Чистый поток по месяцам (переводы между своими счетами не меняют общий остаток)
  const factNet = new Map<number, number>();
  const factInc = new Map<number, number>(); // фактический доход по месяцам
  const factExp = new Map<number, number>(); // фактический расход по месяцам
  for (const t of histTx ?? []) {
    if (t.type === "transfer") continue;
    const d = new Date(t.occurred_on);
    const key = d.getFullYear() * 12 + d.getMonth();
    const v = toBase(t.amount, t.currency, rates);
    factNet.set(key, (factNet.get(key) ?? 0) + (t.type === "income" ? v : -v));
    if (t.type === "income") factInc.set(key, (factInc.get(key) ?? 0) + v);
    else factExp.set(key, (factExp.get(key) ?? 0) + v);
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

  // Данные для графика (в основной валюте, мажорные единицы)
  const trendChart = trendPoints.map((p, i) => ({
    date: p.label,
    total: Math.round(p.value / 100),
    change: i === 0 ? 0 : Math.round((p.value - trendPoints[i - 1].value) / 100),
  }));
  const curSym = team.base_currency === "RUB" ? "₽" : team.base_currency;
  const gapText = formatMoney(gapValue, team.base_currency);

  // Доходы и расходы по месяцам (факт, без переводов) — для пары графиков
  const monthSeries = (src: Map<number, number>) => {
    const out: { date: string; total: number; change: number }[] = [];
    let prev: number | null = null;
    for (let key = curKey - PAST; key <= curKey; key++) {
      const m = ((key % 12) + 12) % 12;
      const v = Math.round((src.get(key) ?? 0) / 100);
      out.push({ date: MONTHS_SHORT[m], total: v, change: prev === null ? 0 : v - prev });
      prev = v;
    }
    return out;
  };
  const incomeChart = monthSeries(factInc);
  const expenseChart = monthSeries(factExp);
  const hasFlows = incomeChart.some((p) => p.total > 0) || expenseChart.some((p) => p.total > 0);

  // ── Прогноз по каждому счёту: где не хватит и нужен перевод ──
  type PlanEv = { occurred_on: string; type: string; amount: number; currency: string; account_id: string | null; transfer_account_id: string | null };
  const evByAcc = new Map<string, { date: string; delta: number }[]>();
  function pushEv(accId: string | null, date: string, delta: number) {
    if (!accId) return;
    const arr = evByAcc.get(accId) ?? [];
    arr.push({ date, delta });
    evByAcc.set(accId, arr);
  }
  for (const t of (planTx ?? []) as PlanEv[]) {
    const v = toBase(t.amount, t.currency, rates);
    if (t.type === "income") pushEv(t.account_id, t.occurred_on, v);
    else if (t.type === "expense") pushEv(t.account_id, t.occurred_on, -v);
    else if (t.type === "transfer") { pushEv(t.account_id, t.occurred_on, -v); pushEv(t.transfer_account_id, t.occurred_on, v); }
  }

  // Проекция минимального остатка по каждому счёту (в базовой валюте)
  const accProjection = (accounts ?? []).map((a) => {
    const startBal = toBase(balanceMap.get(a.id) ?? 0, a.currency, rates);
    // Порядок операций ВНУТРИ дня неизвестен — берём чистый итог дня (а не худший внутридневной сценарий)
    const byDate = new Map<string, number>();
    for (const e of evByAcc.get(a.id) ?? []) byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.delta);
    const dates = [...byDate.keys()].sort();
    let run = startBal, min = startBal, minDate: string | null = null;
    for (const d of dates) { run += byDate.get(d)!; if (run < min) { min = run; minDate = d; } }
    return { id: a.id, name: a.name, currency: a.currency, startBal, min, minDate };
  });
  const shortfalls = accProjection.filter((a) => a.min < 0).sort((a, b) => a.min - b.min);
  const transferWarnings = shortfalls.map((s) => {
    const donors = accProjection.filter((a) => a.id !== s.id && a.currency === s.currency && a.min > 0).sort((a, b) => b.min - a.min);
    const donor = donors[0] ?? null;
    return {
      ...s,
      deficit: -s.min,
      donorName: donor?.name ?? null,
      donorFree: donor?.min ?? 0,
      needConvert: !donor, // нет покрытия в этой валюте
    };
  });

  return (
    <div className="p-6 sm:p-8">
      <InvitesBlock invites={invites} />
      {user && (plannedCount ?? 0) > 0 && (
        <PlannedReview teamId={team.id} count={plannedCount ?? 0} variant="card" />
      )}
      {!onboardingDone && (
        <div className="mb-6 rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-100">Быстрый старт</h2>
            <span className="text-xs text-slate-400">
              {onboarding.filter((s) => s.done).length} из {onboarding.length}
            </span>
          </div>
          <div className="space-y-2">
            {onboarding.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition ${
                  s.done
                    ? "text-slate-400 dark:text-neutral-500"
                    : "bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-white/[0.03] dark:text-neutral-200 dark:hover:bg-white/[0.06]"
                }`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                  s.done ? "bg-emerald-500 text-white" : "ring-1 ring-slate-300 dark:ring-white/20"
                }`}>
                  {s.done ? "✓" : ""}
                </span>
                <span className={s.done ? "line-through" : "font-medium"}>{s.label}</span>
                {!s.done && <span className="ml-auto text-brand">→</span>}
              </Link>
            ))}
          </div>
        </div>
      )}
      {transferWarnings.length > 0 && (
        <div className="mb-6 space-y-2">
          {transferWarnings.map((w) => (
            <Link
              key={w.id}
              href="/transactions"
              className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-amber-50 px-5 py-4 ring-1 ring-amber-200 transition hover:ring-amber-300 dark:bg-amber-950/30 dark:ring-amber-900/40"
            >
              <span className="text-sm text-amber-800 dark:text-amber-200">
                💱 На счёте «<b>{w.name}</b>» ожидается нехватка{" "}
                <b>{formatMoney(w.deficit, team.base_currency)}</b>
                {w.minDate && <> к {new Date(w.minDate).toLocaleDateString("ru-RU")}</>}.{" "}
                {w.needConvert ? (
                  <>Нет свободных средств в {w.currency} — потребуется конвертация с другого счёта.</>
                ) : (
                  <>Сделайте перевод со счёта «<b>{w.donorName}</b>» (свободно ~{formatMoney(w.donorFree, team.base_currency)}).</>
                )}
              </span>
              <span className="text-sm font-medium text-amber-700 dark:text-amber-300">Создать перевод →</span>
            </Link>
          ))}
        </div>
      )}
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

      {/* Сверка по курсу ЦБ */}
      {(cbrUsd || unconverted.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 dark:text-neutral-500">
          {cbrUsd && (
            <span>
              💱 Суммы в валюте пересчитаны в рубли по курсу ЦБ РФ
              {cbr.date ? ` на ${new Date(cbr.date).toLocaleDateString("ru-RU")}` : ""}: USD/USDT ≈{" "}
              <b className="text-slate-500 dark:text-neutral-300">{cbrUsd.toFixed(2)} ₽</b>
            </span>
          )}
          {unconverted.length > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              ⚠️ Нет курса для: {unconverted.join(", ")} — учтены как 1:1.
            </span>
          )}
        </div>
      )}

      {/* Метрики месяца */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric
          title="Доход за месяц"
          accent="emerald"
          sub={plannedIncome > 0 ? `план: +${formatMoney(plannedIncome, team.base_currency)}` : undefined}
        >
          {formatMoney(income, team.base_currency)}
        </Metric>
        <Metric
          title="Расход за месяц"
          accent="red"
          sub={plannedExpense > 0 ? `план: −${formatMoney(plannedExpense, team.base_currency)}` : undefined}
        >
          {formatMoney(expense, team.base_currency)}
        </Metric>
        <Metric
          title="Денежный поток"
          accent="brand"
          sub={
            plannedIncome > 0 || plannedExpense > 0
              ? `с планом: ${formatMoney(income + plannedIncome - expense - plannedExpense, team.base_currency)}`
              : undefined
          }
        >
          {formatMoney(income - expense, team.base_currency)}
        </Metric>
      </div>

      {/* Графики: динамика остатка + доходы/расходы по месяцам */}
      {showTrend && (
        <DashboardCharts
          curSym={curSym}
          baseCurrency={team.base_currency}
          past={PAST}
          trend={trendChart}
          hasGap={hasGap}
          gapLabel={gapLabel}
          gapText={gapText}
          income={incomeChart}
          expense={expenseChart}
          showFlows={hasFlows}
        />
      )}

      {/* Счета */}
      <section className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          Деньги на счетах
        </h2>
        {accounts && accounts.length > 0 ? (
          <>
            <div className="mb-3 flex flex-wrap gap-3">
              {totalByCurrency.size > 1 && (
                <div className="rounded-2xl bg-brand/5 px-5 py-3 ring-1 ring-brand/20">
                  <div className="text-xs text-brand/80">Итого в рублях (по ЦБ)</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white">
                    {formatMoney(currentBalance, team.base_currency)}
                  </div>
                </div>
              )}
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
                  {cur !== team.base_currency && rates[cur] !== undefined && (
                    <div className="text-xs text-slate-400 dark:text-neutral-500">
                      ≈ {formatMoney(toBase(total, cur, rates), team.base_currency)}
                    </div>
                  )}
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

function InvitesBlock({ invites }: { invites: InviteRow[] }) {
  if (invites.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {invites.map((inv) => (
        <div
          key={inv.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-brand/5 px-5 py-4 ring-1 ring-brand/20"
        >
          <div className="text-sm text-slate-700 dark:text-neutral-200">
            Вас пригласили в команду <b>{inv.team?.name ?? "—"}</b> как{" "}
            {ROLE_LABELS[inv.role]}
          </div>
          <AcceptInviteButton inviteId={inv.id} />
        </div>
      ))}
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
  sub,
}: {
  title: string;
  children: React.ReactNode;
  accent: "emerald" | "red" | "brand";
  sub?: string;
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
      {sub && <div className="mt-1 text-xs font-medium text-violet-500 dark:text-violet-400">{sub}</div>}
    </div>
  );
}
