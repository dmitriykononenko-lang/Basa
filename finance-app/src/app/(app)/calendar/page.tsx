import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

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

  const { team } = current;
  const base = team.base_currency;
  const supabase = await createClient();

  const [{ data: balances }, { data: obls }, { data: planned }, { data: fxRows }] = await Promise.all([
    supabase.from("account_balances").select("balance, currency").eq("team_id", team.id),
    supabase
      .from("obligation_balances")
      .select("type, outstanding, currency, due_date")
      .eq("team_id", team.id)
      .gt("outstanding", 0)
      .not("due_date", "is", null),
    supabase
      .from("transactions")
      .select("type, amount, currency, occurred_on")
      .eq("team_id", team.id)
      .eq("status", "planned"),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);
  const startBalance = (balances ?? []).reduce((s, b) => s + toBase(b.balance, b.currency, rates), 0);

  // События по датам
  const dayMap = new Map<string, { in: number; out: number }>();
  function ev(date: string, inc: number, out: number) {
    const g = dayMap.get(date) ?? { in: 0, out: 0 };
    g.in += inc;
    g.out += out;
    dayMap.set(date, g);
  }
  for (const o of (obls ?? []) as unknown as { type: string; outstanding: number; currency: string; due_date: string }[]) {
    const v = toBase(o.outstanding, o.currency, rates);
    if (o.type === "receivable") ev(o.due_date, v, 0);
    else ev(o.due_date, 0, v);
  }
  for (const t of (planned ?? []) as unknown as { type: string; amount: number; currency: string; occurred_on: string }[]) {
    if (t.type === "transfer") continue;
    const v = toBase(t.amount, t.currency, rates);
    if (t.type === "income") ev(t.occurred_on, v, 0);
    else ev(t.occurred_on, 0, v);
  }

  // Глобальный прогон баланса по датам
  const dates = [...dayMap.keys()].sort();
  let running = startBalance;
  let minRunning = startBalance;
  let minDate: string | null = null;
  const dayInfo = new Map<string, { opening: number; in: number; out: number; net: number; closing: number }>();
  for (const d of dates) {
    const g = dayMap.get(d)!;
    const opening = running;
    const net = g.in - g.out;
    running += net;
    if (running < minRunning) { minRunning = running; minDate = d; }
    dayInfo.set(d, { opening, in: g.in, out: g.out, net, closing: running });
  }
  const hasGap = minRunning < 0;

  // Сетка месяца (понедельник — первый)
  const firstDow = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const weeks = Math.ceil((firstDow + daysInMonth) / 7);
  const cells: (number | null)[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const dn = i - firstDow + 1;
    cells.push(dn >= 1 && dn <= daysInMonth ? dn : null);
  }
  const todayStr = now.toISOString().slice(0, 10);
  const mm = String(m).padStart(2, "0");

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

      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-7 gap-px">
            {WEEKDAYS.map((w) => (
              <div key={w} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl bg-slate-200/70 ring-1 ring-slate-200/70 dark:bg-white/[0.04] dark:ring-white/[0.07]">
            {cells.map((dn, i) => {
              if (dn === null) {
                return <div key={i} className="min-h-[120px] bg-slate-50 dark:bg-[#121317]" />;
              }
              const dateStr = `${y}-${mm}-${String(dn).padStart(2, "0")}`;
              const info = dayInfo.get(dateStr);
              const isToday = dateStr === todayStr;
              return (
                <div
                  key={i}
                  className={`min-h-[120px] bg-white p-2 dark:bg-[#15171c] ${isToday ? "ring-2 ring-inset ring-brand/40" : ""}`}
                >
                  <div className={`mb-1 text-right text-sm ${isToday ? "font-bold text-brand" : "text-slate-400 dark:text-neutral-500"}`}>
                    {dn}
                  </div>
                  {info && (
                    <div className="space-y-0.5 text-[11px] leading-tight">
                      <div className="text-slate-400 dark:text-neutral-600">{formatMoney(info.opening, base)}</div>
                      {info.in > 0 && <div className="text-emerald-600 dark:text-emerald-400">+{formatMoney(info.in, base)}</div>}
                      {info.out > 0 && <div className="text-red-600 dark:text-red-400">−{formatMoney(info.out, base)}</div>}
                      <div className={`rounded-md px-1.5 py-0.5 font-semibold ${info.net >= 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"}`}>
                        {info.net >= 0 ? "+" : "−"}{formatMoney(Math.abs(info.net), base)}
                      </div>
                      <div className={`${info.closing < 0 ? "text-red-500" : "text-slate-400 dark:text-neutral-600"}`}>
                        {formatMoney(info.closing, base)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-400 dark:text-neutral-600">
        В ячейке: остаток на начало · +поступления · −выплаты · итог дня · остаток на
        конец. Учитываются сроки непогашенных обязательств (дебиторка/кредиторка,
        включая зарплату) и плановые операции. Прогноз идёт от текущего баланса
        {" "}({formatMoney(startBalance, base)}).
      </p>
    </div>
  );
}
