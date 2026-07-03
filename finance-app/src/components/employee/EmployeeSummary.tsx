import { formatMoney } from "@/lib/format";

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function mLabel(ym: string) {
  const [, m] = ym.split("-");
  return MONTHS_RU[parseInt(m) - 1] ?? ym;
}

export type MonthPoint = { ym: string; accrued: number; paid: number };

const CARD = "rounded-3xl bg-white ring-1 ring-slate-200/70 shadow-[0_2px_8px_-2px_rgba(20,30,20,0.06),0_18px_40px_-24px_rgba(20,30,20,0.25)] dark:bg-[#15171c] dark:ring-white/[0.07] dark:shadow-none";
const LBL = "text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-500";

export default function EmployeeSummary({
  base,
  initials,
  totalAccrued,
  totalPaid,
  totalOut,
  totalPaidActual,
  paidByCur,
  fix,
  variable,
  monthly,
}: {
  base: string;
  initials: string;
  totalAccrued: number;
  totalPaid: number;
  totalOut: number;
  totalPaidActual: number;
  paidByCur: [string, number][];
  fix: { acc: number; paid: number };
  variable: { acc: number; paid: number };
  monthly: MonthPoint[];
}) {
  const pct = totalAccrued > 0 ? totalPaid / totalAccrued : 0;
  const oklPct = fix.acc + variable.acc > 0 ? fix.acc / (fix.acc + variable.acc) : 0;
  const fixClosed = fix.acc > 0 ? Math.round((fix.paid / fix.acc) * 100) : 0;
  const varClosed = variable.acc > 0 ? Math.round((variable.paid / variable.acc) * 100) : 0;

  // ribbon: доля закрытого «шкалой»
  const RIB = [34, 70, 100, 62, 44, 80, 52, 96, 60, 38, 72, 30, 88, 46, 64, 34, 78, 50];
  const onCount = Math.round(pct * RIB.length);

  // gauge (полукруг r=84 → длина ≈ 263.9)
  const ARC = 263.9;
  const dash = ARC * (1 - pct);

  // sparkline из помесячных выплат
  const maxPay = Math.max(1, ...monthly.map((m) => m.paid));
  const spPts = monthly.length
    ? monthly.map((m, i) => {
        const x = monthly.length > 1 ? (i / (monthly.length - 1)) * 196 + 2 : 100;
        const y = 27 - (m.paid / maxPay) * 23;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
    : ["2,27", "198,27"];
  const spLine = spPts.join(" ");
  const spArea = `${spPts[0]} ${spLine} ${spPts[spPts.length - 1].split(",")[0]},30 2,30`;

  // helpers for bar chart
  const maxAcc = Math.max(1, ...monthly.map((m) => m.accrued));

  return (
    <div className="flex flex-col gap-4">
      {/* верхняя полоса */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1.15fr_0.95fr_0.95fr]">
        {/* HERO */}
        <div className={`${CARD} relative row-span-2 overflow-hidden p-6`}>
          <div className="pointer-events-none absolute -bottom-16 -left-10 h-48 w-48 rounded-full bg-brand/20 blur-3xl dark:bg-brand/25" />
          <div className="relative flex h-full flex-col gap-5">
            <div className="flex items-center gap-3.5">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand to-brand/70 text-lg font-extrabold text-white shadow-lg shadow-brand/30">
                {initials}
              </div>
              <div>
                <h3 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">Расчёты по зарплате</h3>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] font-medium text-slate-600 dark:bg-white/[0.06] dark:text-neutral-300">
                    Начислено {formatMoney(totalAccrued, base)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-auto">
              <div className={`${LBL} mb-2`}>Остаток к выплате</div>
              <div className="text-[42px] font-extrabold leading-none tracking-tight text-amber-600 tabular-nums dark:text-amber-400">
                {formatMoney(totalOut, base)}
              </div>

              <div className="mt-4">
                <div className="flex h-11 items-end gap-1">
                  {RIB.map((h, i) => (
                    <span
                      key={i}
                      style={{ height: `${h}%` }}
                      className={`flex-1 rounded-[3px] ${i < onCount ? "bg-brand shadow-[0_2px_8px_-3px] shadow-brand/70" : "bg-slate-200/80 dark:bg-white/[0.08]"}`}
                    />
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-[11.5px] font-medium text-slate-400 dark:text-neutral-500">
                  <span>{monthly[0] ? `${mLabel(monthly[0].ym)} ${monthly[0].ym.slice(0, 4)}` : ""}</span>
                  <span><b className="text-slate-700 dark:text-neutral-200">{Math.round(pct * 100)}%</b> закрыто</span>
                  <span>{monthly.length ? `${mLabel(monthly[monthly.length - 1].ym)} ${monthly[monthly.length - 1].ym.slice(0, 4)}` : ""}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* KPI: Начислено */}
        <div className={`${CARD} flex min-h-[128px] flex-col p-5`}>
          <div className={LBL}>Начислено</div>
          <div className="mt-1 text-[28px] font-extrabold tracking-tight text-slate-900 tabular-nums dark:text-white">{formatMoney(totalAccrued, base)}</div>
          <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:bg-white/[0.06] dark:text-neutral-400">оклад {formatMoney(fix.acc, base)}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:bg-white/[0.06] dark:text-neutral-400">бонусы {formatMoney(variable.acc, base)}</span>
          </div>
        </div>

        {/* KPI: Выплачено деньгами + sparkline */}
        <div className={`${CARD} flex min-h-[128px] flex-col p-5`}>
          <div className={LBL}>Выплачено деньгами</div>
          <div className="mt-1 text-[28px] font-extrabold tracking-tight text-slate-900 tabular-nums dark:text-white">{formatMoney(totalPaidActual, base)}</div>
          <svg className="my-1.5 text-brand" width="100%" height="30" viewBox="0 0 200 30" preserveAspectRatio="none">
            <defs>
              <linearGradient id="empspark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.45" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={spArea} fill="url(#empspark)" />
            <polyline points={spLine} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="mt-auto flex flex-wrap gap-1.5">
            {paidByCur.map(([cur, sum]) => (
              <span key={cur} className="rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand">{formatMoney(sum, cur)}</span>
            ))}
          </div>
        </div>
      </div>

      {/* средний ряд: гейдж · график · структура */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.4fr_0.9fr]">
        {/* Гейдж */}
        <div className={`${CARD} flex flex-col items-center p-5`}>
          <div className={`${LBL} self-start`}>Оплачено</div>
          <svg className="mt-2 text-brand" width="170" height="100" viewBox="0 0 200 116">
            <path d="M18 104 A84 84 0 0 1 182 104" fill="none" className="stroke-slate-100 dark:stroke-white/[0.07]" strokeWidth="17" strokeLinecap="round" />
            <path d="M18 104 A84 84 0 0 1 182 104" fill="none" stroke="currentColor" strokeWidth="17" strokeLinecap="round" strokeDasharray={ARC} strokeDashoffset={dash} />
          </svg>
          <div className="-mt-14 text-center">
            <div className="text-[32px] font-extrabold tracking-tight text-slate-900 tabular-nums dark:text-white">{Math.round(pct * 100)}%</div>
            <div className="mt-0.5 text-[11px] font-medium text-slate-400 dark:text-neutral-500">{formatMoney(totalPaid, base)} из {formatMoney(totalAccrued, base)}</div>
          </div>
        </div>

        {/* График по месяцам */}
        <div className={`${CARD} p-5`}>
          <div className="mb-4 flex items-baseline justify-between">
            <div className={LBL}>По месяцам · начислено / выплачено</div>
            <div className="flex gap-3 text-[11.5px] font-medium text-slate-400 dark:text-neutral-500">
              <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded bg-slate-200 dark:bg-white/[0.12]" />начислено</span>
              <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded bg-brand" />выплачено</span>
            </div>
          </div>
          <div className="flex h-[120px] items-end gap-2">
            {monthly.map((m) => (
              <div key={m.ym} className="flex h-full flex-1 flex-col items-center gap-2" title={`${mLabel(m.ym)}: ${formatMoney(m.paid, base)} из ${formatMoney(m.accrued, base)}`}>
                <div className="relative w-full max-w-[30px] flex-1 overflow-hidden rounded-t-lg rounded-b bg-slate-100/70 dark:bg-white/[0.05]">
                  <div className="absolute inset-x-0 bottom-0 rounded-t-lg bg-slate-200 dark:bg-white/[0.12]" style={{ height: `${(m.accrued / maxAcc) * 100}%` }} />
                  <div className="absolute inset-x-0 bottom-0 rounded-t-md bg-brand shadow-[0_0_14px_-4px] shadow-brand/80" style={{ height: `${(m.paid / maxAcc) * 100}%` }} />
                </div>
                <div className="text-[10.5px] font-semibold text-slate-400 dark:text-neutral-500">{mLabel(m.ym)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Структура */}
        <div className={`${CARD} p-5`}>
          <div className={`${LBL} mb-3.5`}>Структура начислений</div>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-[22px] font-extrabold tracking-tight text-slate-900 tabular-nums dark:text-white">{formatMoney(fix.acc, base)}</span>
            <span className="text-[22px] font-extrabold tracking-tight text-slate-400 tabular-nums dark:text-neutral-500">{formatMoney(variable.acc, base)}</span>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
            <div className="bg-brand" style={{ width: `${oklPct * 100}%` }} />
            <div className="bg-slate-300 dark:bg-white/[0.18]" style={{ width: `${(1 - oklPct) * 100}%` }} />
          </div>
          <div className="mt-2.5 flex justify-between text-[11.5px] font-medium text-slate-400 dark:text-neutral-500">
            <span><b className="text-slate-700 dark:text-neutral-200">Оклад</b> · {Math.round(oklPct * 100)}%</span>
            <span>{Math.round((1 - oklPct) * 100)}% · <b className="text-slate-700 dark:text-neutral-200">Бонусы</b></span>
          </div>
          <div className="mt-5 flex justify-between text-[11.5px] font-medium text-slate-400 dark:text-neutral-500">
            <span>Закрыто оклада <b className="text-slate-700 dark:text-neutral-200">{fixClosed}%</b></span>
            <span>Закрыто бонусов <b className="text-slate-700 dark:text-neutral-200">{varClosed}%</b></span>
          </div>
        </div>
      </div>
    </div>
  );
}
