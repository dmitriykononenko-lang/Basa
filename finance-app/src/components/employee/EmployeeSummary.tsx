import { formatMoney } from "@/lib/format";

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function mLabel(ym: string) {
  const [, m] = ym.split("-");
  return MONTHS_RU[parseInt(m) - 1] ?? ym;
}

export type MonthPoint = { ym: string; accrued: number; paid: number };

const CARD = "rounded-[26px] bg-white ring-1 ring-slate-200/60 shadow-[0_1px_3px_rgba(20,30,20,0.04),0_14px_30px_-20px_rgba(20,30,20,0.16)] dark:bg-[#15171c] dark:ring-white/[0.06] dark:shadow-none";
const LBL = "text-[10.5px] font-bold uppercase tracking-[0.13em] text-slate-400 dark:text-neutral-500";
const CORNER = "absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-xl bg-slate-50 text-slate-400 ring-1 ring-slate-200/70 transition hover:text-slate-600 dark:bg-white/[0.04] dark:text-neutral-500 dark:ring-white/[0.06]";

export default function EmployeeSummary({
  base, initials, totalAccrued, totalPaid, totalOut, totalPaidActual, paidByCur, fix, variable, monthly,
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

  // большой гейдж (полукруг r=110 → длина ≈ 345.6)
  const ARC = 345.6;
  const dash = ARC * (1 - pct);

  // кумулятивные линии начислено/выплачено
  let ca = 0, cp = 0;
  const cum = monthly.map((m) => { ca += m.accrued; cp += m.paid; return { ym: m.ym, ca, cp }; });
  const maxC = Math.max(1, ca);
  const n = cum.length;
  const xAt = (i: number) => (n > 1 ? 12 + (i / (n - 1)) * 276 : 150);
  const yAt = (v: number) => 118 - (v / maxC) * 100;
  const accLine = cum.map((c, i) => `${xAt(i).toFixed(1)},${yAt(c.ca).toFixed(1)}`).join(" ");
  const payLine = cum.map((c, i) => `${xAt(i).toFixed(1)},${yAt(c.cp).toFixed(1)}`).join(" ");
  const payArea = n ? `12,124 ${payLine} ${xAt(n - 1).toFixed(1)},124` : "";

  // спарклайн выплат помесячно (для карточки)
  const maxPay = Math.max(1, ...monthly.map((m) => m.paid));
  const sp = monthly.length
    ? monthly.map((m, i) => `${(monthly.length > 1 ? (i / (monthly.length - 1)) * 196 + 2 : 100).toFixed(1)},${(27 - (m.paid / maxPay) * 23).toFixed(1)}`)
    : ["2,27", "198,27"];

  return (
    <div className="flex flex-col gap-4">
      {/* Ряд 1: гейдж-герой + тренд */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.1fr]">
        {/* Гейдж-герой */}
        <div className={`${CARD} relative overflow-hidden p-6`}>
          <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-brand/[0.07] blur-3xl" />
          <div className="relative flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand to-brand/70 text-[13px] font-extrabold text-white shadow-md shadow-brand/30">{initials}</div>
            <div className={LBL}>Оплачено начислений</div>
          </div>

          <div className="relative mt-2 flex flex-col items-center">
            <svg className="text-brand" width="290" height="158" viewBox="0 0 280 154">
              <defs>
                <linearGradient id="empgauge" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="currentColor" stopOpacity="0.55" />
                  <stop offset="1" stopColor="currentColor" />
                </linearGradient>
              </defs>
              <path d="M30 140 A110 110 0 0 1 250 140" fill="none" className="stroke-slate-100 dark:stroke-white/[0.06]" strokeWidth="18" strokeLinecap="round" />
              <path d="M30 140 A110 110 0 0 1 250 140" fill="none" stroke="url(#empgauge)" strokeWidth="18" strokeLinecap="round" strokeDasharray={ARC} strokeDashoffset={dash} />
            </svg>
            <div className="-mt-[104px] flex flex-col items-center">
              <div className="text-[52px] font-extrabold leading-none tracking-tight text-slate-900 tabular-nums dark:text-white">{Math.round(pct * 100)}<span className="text-[26px] text-slate-400">%</span></div>
              <div className="mt-2 text-[12px] font-medium text-slate-400 dark:text-neutral-500">{formatMoney(totalPaid, base)} из {formatMoney(totalAccrued, base)}</div>
            </div>
          </div>

          <div className="relative mt-5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4 dark:border-white/[0.06]">
            <MiniStat label="Начислено" value={formatMoney(totalAccrued, base)} />
            <MiniStat label="Выплачено" value={formatMoney(totalPaid, base)} tone="brand" />
            <MiniStat label="Остаток" value={formatMoney(totalOut, base)} tone={totalOut > 0 ? "amber" : "ok"} />
          </div>
        </div>

        {/* Тренд начислено/выплачено */}
        <div className={`${CARD} relative p-6`}>
          <div className={CORNER}>↗</div>
          <div className={LBL}>Динамика · начислено / выплачено</div>
          <div className="mt-1 flex items-end gap-4">
            <div>
              <div className="text-[28px] font-extrabold tracking-tight text-slate-900 tabular-nums dark:text-white">{formatMoney(totalPaidActual, base)}</div>
              <div className="text-[12px] font-medium text-slate-400 dark:text-neutral-500">выплачено деньгами</div>
            </div>
          </div>
          <svg className="mt-3 w-full text-brand" height="150" viewBox="0 0 300 150" preserveAspectRatio="none">
            <defs>
              <linearGradient id="emptrend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            {payArea && <polygon points={payArea} fill="url(#emptrend)" />}
            <polyline points={accLine} fill="none" className="stroke-slate-300 dark:stroke-white/20" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 5" />
            <polyline points={payLine} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            {n > 0 && <circle cx={xAt(n - 1)} cy={yAt(cum[n - 1].cp)} r="4" fill="currentColor" />}
          </svg>
          <div className="mt-1 flex justify-between text-[10.5px] font-semibold text-slate-400 dark:text-neutral-500">
            {monthly.map((m) => <span key={m.ym}>{mLabel(m.ym)}</span>)}
          </div>
          <div className="mt-3 flex gap-4 text-[11.5px] font-medium text-slate-400 dark:text-neutral-500">
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-full bg-brand" />выплачено (накопл.)</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4 rounded-full bg-slate-300 dark:bg-white/20" />начислено (накопл.)</span>
          </div>
        </div>
      </div>

      {/* Ряд 2: карточки-инсайты */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Начислено */}
        <div className={`${CARD} relative p-5`}>
          <div className={CORNER}>↗</div>
          <div className={LBL}>Начислено</div>
          <div className="mt-1.5 text-[26px] font-extrabold tracking-tight text-slate-900 tabular-nums dark:text-white">{formatMoney(totalAccrued, base)}</div>
          <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
            <div className="bg-brand" style={{ width: `${oklPct * 100}%` }} />
            <div className="bg-slate-300 dark:bg-white/[0.18]" style={{ width: `${(1 - oklPct) * 100}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[11px] font-medium text-slate-400 dark:text-neutral-500">
            <span>оклад {formatMoney(fix.acc, base)}</span><span>бонусы {formatMoney(variable.acc, base)}</span>
          </div>
        </div>

        {/* Выплачено деньгами */}
        <div className={`${CARD} relative p-5`}>
          <div className={CORNER}>↗</div>
          <div className={LBL}>Выплачено деньгами</div>
          <div className="mt-1.5 text-[26px] font-extrabold tracking-tight text-slate-900 tabular-nums dark:text-white">{formatMoney(totalPaidActual, base)}</div>
          <svg className="my-1.5 text-brand" width="100%" height="30" viewBox="0 0 200 30" preserveAspectRatio="none">
            <defs><linearGradient id="empspark2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity="0.4" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
            <polygon points={`${sp[0]} ${sp.join(" ")} ${sp[sp.length - 1].split(",")[0]},30 2,30`} fill="url(#empspark2)" />
            <polyline points={sp.join(" ")} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="flex flex-wrap gap-1.5">
            {paidByCur.map(([cur, sum]) => <span key={cur} className="rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand">{formatMoney(sum, cur)}</span>)}
          </div>
        </div>

        {/* Остаток */}
        <div className={`${CARD} relative p-5`}>
          <div className={CORNER}>↗</div>
          <div className="flex items-center gap-2">
            <div className={LBL}>Остаток к выплате</div>
            {totalOut > 0
              ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">Есть долг</span>
              : <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">Закрыт</span>}
          </div>
          <div className={`mt-1.5 text-[26px] font-extrabold tracking-tight tabular-nums ${totalOut > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{formatMoney(totalOut, base)}</div>
          <div className="mt-4 text-[12px] font-medium text-slate-400 dark:text-neutral-500">
            {Math.round((1 - pct) * 100)}% от начисленного ещё не выплачено
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "brand" | "amber" | "ok" }) {
  const c = tone === "brand" ? "text-brand" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white";
  return (
    <div className="text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">{label}</div>
      <div className={`mt-1 text-[14px] font-extrabold tabular-nums ${c}`}>{value}</div>
    </div>
  );
}
