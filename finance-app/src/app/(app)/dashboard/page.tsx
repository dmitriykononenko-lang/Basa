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
import ProgressMetricCard from "@/components/ui/progress-metric-card";
import TotalIncomeCard from "@/components/ui/total-income-card";
import TotalIncomeRecharts from "@/components/ui/total-income-recharts-lazy";
import DashboardWidgets, { type Widget } from "@/components/ui/dashboard-widgets";
import AcademyWidget from "@/components/academy/AcademyWidget";
import MetricsWidget from "@/components/metrics/MetricsWidget";
import CashflowHero from "@/components/CashflowHero";
import PlannedReview from "@/components/PlannedReview";
import { loadUnallocatedPayments } from "@/lib/unallocated";

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
  const base = team.base_currency;

  // Имя для приветствия (первое слово из имени профиля / e-mail).
  const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user?.id ?? "").maybeSingle();
  const firstName = ((prof?.full_name ?? user?.email ?? "").trim().split(/[\s@]/)[0]) || "коллега";

  // ── Даты для запросов (сервер Vercel работает в UTC) ──
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const curKey = curY * 12 + curM;
  const PAST = 11; // месяцев истории до текущего (для периодов 3M/6M/12M)
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
    supabase.from("transactions").select("type, amount, currency, occurred_on, account_id, transfer_account_id").eq("team_id", team.id).eq("status", "planned"),
    supabase.from("obligation_balances").select("type, outstanding, currency, due_date").eq("team_id", team.id).gt("outstanding", 0).gte("due_date", today),
  ]);

  // Годовые/полугодовые выборки — постранично (операций за период может быть >1000)
  const yearExp = await fetchAllRows((from, to) =>
    supabase.from("transactions").select("category_id, amount, currency, occurred_on").eq("team_id", team.id).eq("type", "expense").eq("status", "actual").gte("occurred_on", yearStart).order("occurred_on", { ascending: true }).range(from, to)
  );
  const histTx = await fetchAllRows((from, to) =>
    supabase.from("transactions").select("type, amount, currency, occurred_on").eq("team_id", team.id).eq("status", "actual").gte("occurred_on", sixStart).order("occurred_on", { ascending: true }).range(from, to)
  );
  // Доход по счетам за год — для разбивки «источники дохода» в виджете
  const incByAccRows = await fetchAllRows<{ account_id: string | null; amount: number; currency: string }>((from, to) =>
    supabase.from("transactions").select("account_id, amount, currency").eq("team_id", team.id).eq("type", "income").eq("status", "actual").gte("occurred_on", yearStart).order("occurred_on", { ascending: true }).range(from, to)
  );
  const { data: catRows } = await supabase.from("categories").select("id, name").eq("team_id", team.id);

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

  // Нераспределённые выплаты (операции контрагентам с открытым долгом, не разнесённые)
  const unallocatedPayments = await loadUnallocatedPayments(supabase, team.id, rates);
  const unallocatedCount = unallocatedPayments.length;
  const unallocatedAmount = unallocatedPayments.reduce((s, u) => s + u.remainingBase, 0);

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

  // Сравнение с прошлым месяцем (тот же набор: факт, без переводов)
  const prevKey = curKey - 1;
  const prevIncome = factInc.get(prevKey) ?? 0;
  const prevExpense = factExp.get(prevKey) ?? 0;
  const prevFlow = prevIncome - prevExpense;
  const momPct = (cur: number, prev: number): number | null =>
    prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null;

  // ── Прогноз денежных средств ПО ДНЯМ — чтобы ловить внутримесячные кассовые
  // разрывы (напр. крупный расход 24-го до прихода 26-го). Помесячная свёртка их прячет.
  const DAYMS = 86400000;
  const dayOf = (s: string) => Math.floor(new Date(s + "T00:00:00").getTime() / DAYMS);
  const isoOf = (d: number) => new Date(d * DAYMS).toISOString().slice(0, 10);
  const tDay = dayOf(today);

  // История: закрытие прошлых месяцев — обратным ходом от текущего баланса
  const closeByKey = new Map<number, number>();
  closeByKey.set(curKey, currentBalance);
  for (let k = 1; k <= PAST; k++) {
    const key = curKey - k;
    closeByKey.set(key, closeByKey.get(key + 1)! - (factNet.get(key + 1) ?? 0));
  }

  // События прогноза: плановые операции (просроченные планы → к сегодня) и
  // будущие обязательства (приход +, выплата −).
  const evByDay = new Map<number, number>();
  const pushEvDay = (dateStr: string, delta: number) => {
    const d = Math.max(dayOf(dateStr), tDay);
    evByDay.set(d, (evByDay.get(d) ?? 0) + delta);
  };
  for (const t of planTx ?? []) {
    if (t.type === "transfer") continue; // переводы между своими счетами не меняют общий остаток
    const v = toBase(t.amount, t.currency, rates);
    pushEvDay(t.occurred_on, t.type === "income" ? v : -v);
  }
  for (const o of (futureObl ?? []) as { type: string; outstanding: number; currency: string; due_date: string }[]) {
    const v = toBase(o.outstanding, o.currency, rates);
    pushEvDay(o.due_date, o.type === "receivable" ? v : -v);
  }

  // Дневной прогнозный остаток + поиск минимума ниже нуля (кассовый разрыв)
  const horizonDay = dayOf(new Date(curY, curM + 1 + FUT, 0).toISOString().slice(0, 10));
  const evDays = [...evByDay.keys()].sort((a, b) => a - b);
  let run = currentBalance;
  const forecastPts: { date: string; value: number; forecast: boolean }[] = [];
  let gap: { date: string; value: number } | null = null;
  for (const d of evDays) {
    run += evByDay.get(d)!;
    forecastPts.push({ date: isoOf(d), value: run, forecast: true });
    if (run < 0 && (!gap || run < gap.value)) gap = { date: isoOf(d), value: run };
  }
  const lastDay = evDays.length ? evDays[evDays.length - 1] : tDay;
  if (lastDay < horizonDay) forecastPts.push({ date: isoOf(horizonDay), value: run, forecast: true });

  // Точки графика: помесячная история + «сейчас» + дневной прогноз
  const heroPoints: { date: string; value: number; forecast: boolean }[] = [];
  for (let k = PAST; k >= 1; k--) {
    const key = curKey - k;
    const y = Math.floor(key / 12), m = key % 12;
    heroPoints.push({ date: new Date(y, m + 1, 0).toISOString().slice(0, 10), value: closeByKey.get(key) ?? 0, forecast: false });
  }
  heroPoints.push({ date: today, value: currentBalance, forecast: false });
  heroPoints.push(...forecastPts);

  const showTrend = (accounts?.length ?? 0) > 0;
  const curSym = team.base_currency === "RUB" ? "₽" : team.base_currency;

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
  // Преобразование месячных рядов в точки для карточек-метрик
  const toPoints = (arr: { date: string; total: number }[]) => arr.map((p) => ({ value: p.total, date: p.date }));

  // Источники дохода: доход по счетам за год (в базовой валюте, мажорные единицы)
  const accNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const incByAcc = new Map<string, number>();
  for (const r of incByAccRows ?? []) {
    const key = r.account_id ?? "—";
    incByAcc.set(key, (incByAcc.get(key) ?? 0) + toBase(r.amount, r.currency, rates));
  }
  const incTotalYear = [...incByAcc.values()].reduce((s, v) => s + v, 0) || 1;
  const incomeSources = [...incByAcc.entries()]
    .map(([id, v]) => ({ name: accNameById.get(id) ?? "Прочее", amount: Math.round(v / 100), share: v / incTotalYear }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4);

  // Расходы по статьям за год (топ-источники) — для виджета
  const catNameById = new Map((catRows ?? []).map((c) => [c.id, c.name]));
  const expByCat = new Map<string, number>();
  for (const t of yearExp ?? []) {
    const key = t.category_id ?? "—";
    expByCat.set(key, (expByCat.get(key) ?? 0) + toBase(t.amount, t.currency, rates));
  }
  const expTotalYear = [...expByCat.values()].reduce((s, v) => s + v, 0) || 1;
  const expenseCats = [...expByCat.entries()]
    .map(([id, v]) => ({ name: catNameById.get(id) ?? "Без статьи", amount: Math.round(v / 100), share: v / expTotalYear }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4);

  // Прибыль по месяцам = доходы − расходы
  const profitChart = incomeChart.map((p, i) => ({ date: p.date, total: p.total - (expenseChart[i]?.total ?? 0) }));

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
    const dt = t.occurred_on < today ? today : t.occurred_on; // просроченный план — к сегодня
    if (t.type === "income") pushEv(t.account_id, dt, v);
    else if (t.type === "expense") pushEv(t.account_id, dt, -v);
    else if (t.type === "transfer") { pushEv(t.account_id, dt, -v); pushEv(t.transfer_account_id, dt, v); }
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
      {unallocatedCount > 0 && (
        <Link
          href="/debts#unallocated"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-amber-50 px-5 py-4 ring-1 ring-amber-200 transition hover:ring-amber-300 dark:bg-amber-950/30 dark:ring-amber-900/40"
        >
          <span className="text-sm text-amber-800 dark:text-amber-200">
            🧾 Нераспределённые выплаты: <b>{unallocatedCount}</b> на сумму{" "}
            <b>{formatMoney(unallocatedAmount, team.base_currency)}</b> — привяжите к обязательствам
          </span>
          <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
            Разнести →
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
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm capitalize text-slate-400 dark:text-neutral-500">
            {now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
          <h1 className="mt-0.5 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            С возвращением, {firstName}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/transactions" className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">↗ Приход</Link>
          <Link href="/transactions" className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:ring-slate-300 dark:bg-white/[0.04] dark:text-neutral-200 dark:ring-white/10">↘ Расход</Link>
          <Link href="/transactions" className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:ring-slate-300 dark:bg-white/[0.04] dark:text-neutral-200 dark:ring-white/10">⇄ Перевод</Link>
          <Link href="/transactions/import" className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:ring-slate-300 dark:bg-white/[0.04] dark:text-neutral-200 dark:ring-white/10">↑ Импорт</Link>
        </div>
      </header>

      {/* Основная сетка: Обзор + Движение денег (слева), Счета (справа) */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Обзор */}
          <section className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Обзор</h2>
            <div className="mt-2 text-xs text-slate-400 dark:text-neutral-500">Денежные средства на счетах</div>
            <div className="mt-0.5 text-3xl font-extrabold tabular-nums text-slate-900 dark:text-white">{formatMoney(currentBalance, base)}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">↗ {formatMoney(income, base)}</span>
              <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400">↘ {formatMoney(expense, base)}</span>
              <span className="text-slate-400 dark:text-neutral-500">чистый поток: <b className="text-slate-600 dark:text-neutral-300">{formatMoney(income - expense, base)}</b></span>
            </div>
            {showTrend && (
              <div className="mt-4">
                <CashflowHero points={heroPoints} gap={gap} today={today} base={base} />
              </div>
            )}
          </section>

          {/* Движение денег */}
          <section className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Движение денег</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500 dark:bg-white/[0.06] dark:text-neutral-400">{MONTHS_SHORT[curM]} {curY}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FlowCard kind="in" total={income} top={incomeSources[0]} base={base} />
              <FlowCard kind="out" total={expense} top={expenseCats[0]} base={base} />
            </div>
          </section>
        </div>

        {/* Счета */}
        <div className="space-y-5">
          <section className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Счета</h2>
              {totalByCurrency.size > 1 && <span className="text-xs text-slate-400 dark:text-neutral-500">≈ {formatMoney(currentBalance, base)}</span>}
            </div>
            {accounts && accounts.length > 0 ? (
              <div className="space-y-1">
                {accounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 rounded-2xl px-2.5 py-2 transition hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={`h-8 w-8 shrink-0 rounded-lg ${acctColor(a.name)}`} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-800 dark:text-neutral-200">{a.name}</div>
                        <div className="text-[11px] text-slate-400 dark:text-neutral-500">{a.currency}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">{formatMoney(balanceMap.get(a.id) ?? 0, a.currency)}</div>
                      {a.currency !== base && rates[a.currency] !== undefined && (
                        <div className="text-[11px] text-slate-400 dark:text-neutral-500">≈ {formatMoney(toBase(balanceMap.get(a.id) ?? 0, a.currency, rates), base)}</div>
                      )}
                    </div>
                  </div>
                ))}
                <Link href="/accounts" className="mt-2 block rounded-2xl bg-slate-50 py-2 text-center text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:bg-white/[0.03] dark:text-neutral-300 dark:hover:bg-white/[0.06]">Показать все счета</Link>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-neutral-400">Пока нет счетов. Добавьте их в разделе «Счета».</p>
            )}
          </section>
        </div>
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

      {/* Карточки-метрики: доходы/расходы/прибыль по месяцам */}
      {showTrend && (
        <section className="mt-6">
          <DashboardWidgets
            widgets={[
              ...(hasFlows
                ? [
                    {
                      id: "income_recharts",
                      label: "Доходы (recharts, с источниками)",
                      node: <TotalIncomeRecharts points={toPoints(incomeChart)} sources={incomeSources} sym={curSym} />,
                    },
                    {
                      id: "profit",
                      label: "Прибыль",
                      node: <ProgressMetricCard size="sm" title="Прибыль" unit={curSym} data={toPoints(profitChart)} />,
                    },
                    {
                      id: "expense_cat",
                      label: "Расходы по статьям",
                      node: <TotalIncomeCard title="Расходы по статьям" color="#f43f5e" points={toPoints(expenseChart)} sources={expenseCats} sym={curSym} />,
                    },
                    {
                      id: "income",
                      label: "Доходы (лёгкий график)",
                      node: <TotalIncomeCard points={toPoints(incomeChart)} sources={incomeSources} sym={curSym} />,
                    },
                    {
                      id: "expense",
                      label: "Расходы (просто)",
                      node: <ProgressMetricCard size="sm" title="Расходы" accent="rose" unit={curSym} data={toPoints(expenseChart)} />,
                    },
                  ]
                : []),
              {
                id: "academy",
                label: "Обучение",
                node: <AcademyWidget />,
              },
              {
                id: "metrics",
                label: "Показатели",
                node: <MetricsWidget />,
              },
            ] satisfies Widget[]}
            defaultHidden={["income", "expense"]}
          />
        </section>
      )}

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

// Карточка притока/оттока в блоке «Движение денег».
function FlowCard({ kind, total, top, base }: {
  kind: "in" | "out";
  total: number;
  top?: { name: string; amount: number; share: number };
  base: string;
}) {
  const isIn = kind === "in";
  const share = Math.max(0, Math.min(1, top?.share ?? 0));
  return (
    <div className="rounded-2xl bg-slate-50 p-4 dark:bg-white/[0.03]">
      <div className="text-xs font-medium text-slate-500 dark:text-neutral-400">{isIn ? "Приход" : "Расход"}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${isIn ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
        {formatMoney(total, base)}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <div className={`h-full rounded-full ${isIn ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      {top && top.amount > 0 ? (
        <div className="mt-2 text-xs text-slate-400 dark:text-neutral-500">
          {isIn ? "Крупнейший доход" : "Крупнейший расход"} — <span className="font-medium text-slate-600 dark:text-neutral-300">{top.name}</span> · {(share * 100).toFixed(1)}%
        </div>
      ) : (
        <div className="mt-2 text-xs text-slate-400 dark:text-neutral-500">за месяц</div>
      )}
    </div>
  );
}

// Стабильный цвет квадрата счёта.
const ACCT_COLORS = ["bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500", "bg-rose-500", "bg-cyan-500", "bg-orange-500", "bg-teal-500"];
function acctColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ACCT_COLORS[h % ACCT_COLORS.length];
}
