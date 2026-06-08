import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import { fetchCbrRates } from "@/lib/cbr";
import CalendarGrid, { type Cell } from "@/components/CalendarGrid";

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function ym(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const now = new Date();
  const [y, m] = (month && /^\d{4}-\d{2}$/.test(month) ? month : ym(now))
    .split("-")
    .map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const prev = ym(new Date(y, m - 2, 1));
  const next = ym(new Date(y, m, 1));

  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Платёжный календарь
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const base = team.base_currency;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const todayStr = now.toISOString().slice(0, 10);

  const [{ data: balances }, { data: obls }, { data: txs }, { data: fxRows }] = await Promise.all([
    supabase.from("account_balances").select("balance, currency").eq("team_id", team.id),
    supabase
      .from("obligation_balances")
      .select("id, type, outstanding, currency, due_date")
      .eq("team_id", team.id)
      .gt("outstanding", 0)
      .not("due_date", "is", null),
    // И плановые, и фактические — чтобы видеть все приходы/выплаты и суммировать их по дням
    supabase
      .from("transactions")
      .select("type, amount, currency, occurred_on, status, obligation_id")
      .eq("team_id", team.id)
      .in("status", ["actual", "planned"]),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);
  // Курс ЦБ РФ на сегодня для валют без ручного курса (USD/USDT) — иначе приход в валюте занижается
  if (base === "RUB") {
    const cbr = await fetchCbrRates();
    for (const [cur, r] of Object.entries(cbr.rates)) {
      if (rates[cur] === undefined) rates[cur] = r;
    }
  }
  // Текущий остаток = только фактические операции (account_balances)
  const startBalance = (balances ?? []).reduce((s, b) => s + toBase(b.balance, b.currency, rates), 0);

  // Просроченные плановые/обязательства (срок раньше сегодня) считаем «к оплате сегодня»
  const fold = (d: string) => (d < todayStr ? todayStr : d);

  // Раздельно копим: фактические (по реальной дате) и плановые+обязательства (по дате с учётом переноса просрочки)
  const actIn = new Map<string, number>();
  const actOut = new Map<string, number>();
  const planIn = new Map<string, number>();
  const planOut = new Map<string, number>();
  const actualNet = new Map<string, number>(); // нетто факта по реальной дате (для разворачивания баланса)
  const plannedByObl = new Map<string, number>(); // запланировано платежей по обязательству (в базовой валюте)
  const add = (mp: Map<string, number>, k: string, v: number) => mp.set(k, (mp.get(k) ?? 0) + v);

  for (const t of (txs ?? []) as unknown as { type: string; amount: number; currency: string; occurred_on: string; status: string; obligation_id: string | null }[]) {
    if (t.type === "transfer") continue; // переводы между своими счетами не меняют общий остаток
    const v = toBase(t.amount, t.currency, rates);
    if (t.status === "actual") {
      if (t.type === "income") add(actIn, t.occurred_on, v);
      else add(actOut, t.occurred_on, v);
      add(actualNet, t.occurred_on, t.type === "income" ? v : -v);
    } else {
      const d = fold(t.occurred_on);
      if (t.type === "income") add(planIn, d, v);
      else add(planOut, d, v);
      if (t.obligation_id) add(plannedByObl, t.obligation_id, v); // учтём для дедупа с обязательством
    }
  }
  // Обязательства: добавляем только НЕзапланированную часть (запланированный платёж уже учтён выше как операция)
  for (const o of (obls ?? []) as unknown as { id: string; type: string; outstanding: number; currency: string; due_date: string }[]) {
    const remaining = toBase(o.outstanding, o.currency, rates) - (plannedByObl.get(o.id) ?? 0);
    if (remaining <= 0) continue;
    const d = fold(o.due_date);
    if (o.type === "receivable") add(planIn, d, remaining);
    else add(planOut, d, remaining);
  }

  const planNet = new Map<string, number>();
  for (const k of new Set([...planIn.keys(), ...planOut.keys()])) {
    planNet.set(k, (planIn.get(k) ?? 0) - (planOut.get(k) ?? 0));
  }

  // Остаток на конец дня D = текущий остаток − факт после D + план (с учётом переноса) до D включительно.
  // Так прошлые дни показывают реальную историю по факту, а будущее — прогноз от сегодняшнего остатка.
  const planAsc = [...planNet.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const actAsc = [...actualNet.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  function closingAt(D: string): number {
    let s = startBalance;
    for (let i = actAsc.length - 1; i >= 0; i--) {
      if (actAsc[i][0] > D) s -= actAsc[i][1];
      else break;
    }
    for (const [x, n] of planAsc) {
      if (x <= D) s += n;
      else break;
    }
    return s;
  }

  // Кассовый разрыв — минимальный прогнозный остаток начиная с сегодня (включая будущие месяцы)
  const horizon = new Set<string>([todayStr, ...planNet.keys()]);
  for (const x of actualNet.keys()) if (x >= todayStr) horizon.add(x);
  let minRunning = Infinity;
  let minDate: string | null = null;
  for (const d of horizon) {
    if (d < todayStr) continue;
    const c = closingAt(d);
    if (c < minRunning) { minRunning = c; minDate = d; }
  }
  const hasGap = minRunning < 0;

  // Сетка месяца (понедельник — первый)
  const firstDow = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const weeks = Math.ceil((firstDow + daysInMonth) / 7);
  const mm = String(m).padStart(2, "0");
  const cells: Cell[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const dn = i - firstDow + 1;
    if (dn < 1 || dn > daysInMonth) { cells.push({ dn: null, dateStr: null, info: null }); continue; }
    const dateStr = `${y}-${mm}-${String(dn).padStart(2, "0")}`;
    const inV = (actIn.get(dateStr) ?? 0) + (planIn.get(dateStr) ?? 0);
    const outV = (actOut.get(dateStr) ?? 0) + (planOut.get(dateStr) ?? 0);
    if (inV === 0 && outV === 0) { cells.push({ dn, dateStr, info: null }); continue; }
    const net = inV - outV;
    const closing = closingAt(dateStr);
    cells.push({ dn, dateStr, info: { opening: closing - net, in: inV, out: outV, net, closing } });
  }

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Платёжный календарь
        </h1>
        <div className="flex items-center gap-2">
          <Link href={`/calendar?month=${prev}`} className="btn-ghost px-3">←</Link>
          <span className="min-w-[140px] text-center text-sm font-semibold text-slate-700 dark:text-neutral-200">
            {MONTHS_RU[m - 1]} {y}
          </span>
          <Link href={`/calendar?month=${next}`} className="btn-ghost px-3">→</Link>
        </div>
      </header>

      {hasGap && (
        <div className="mb-5 rounded-3xl bg-red-50 px-5 py-3 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/40">
          🚨 Прогнозируется кассовый разрыв: баланс опустится до{" "}
          <b>{formatMoney(minRunning, base)}</b>
          {minDate && <> ({new Date(minDate).toLocaleDateString("ru-RU")})</>}.
        </div>
      )}

      <CalendarGrid
        cells={cells}
        base={base}
        todayStr={todayStr}
        teamId={team.id}
        userId={user?.id ?? ""}
        canEdit={canEditFinance(role)}
      />

      <p className="mt-4 text-xs text-slate-400 dark:text-neutral-600">
        В ячейке: остаток на начало · +поступления · −выплаты · итог дня · остаток на
        конец. Суммируются <b>фактические и плановые</b> операции, а также сроки непогашенных
        обязательств (дебиторка/кредиторка, включая зарплату). Валюта пересчитывается в рубли
        по курсу ЦБ. Прогноз идёт от текущего остатка ({formatMoney(startBalance, base)});
        просроченные платежи и обязательства учитываются на сегодня.
      </p>
    </div>
  );
}
