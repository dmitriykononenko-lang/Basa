import type { ReactNode } from "react";
import { formatMoney } from "@/lib/format";

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function mLabel(ym: string) {
  const [, m] = ym.split("-");
  return MONTHS_RU[parseInt(m) - 1] ?? ym;
}

export type MonthPoint = { ym: string; accrued: number; paid: number };

// Дизайн-система референса: Manrope (наследуется от обёртки), палитра
// синий #3C91E6 · зелёный #29BF12 · красный #F4442E · текст #272727 · near-white карточки.
const CARD = "relative rounded-[26px] bg-[#fbfcf9] ring-1 ring-black/[0.05] shadow-[0_1px_2px_rgba(20,25,15,0.04),0_16px_34px_-22px_rgba(20,25,15,0.20)] dark:bg-[#191d19] dark:ring-white/[0.06] dark:shadow-none";
const LABEL = "text-[11px] font-semibold uppercase tracking-[0.11em] text-[#82867b] dark:text-neutral-500";
const INK = "text-[#272727] dark:text-neutral-100";

function Pie() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" className={INK} fill="none">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 8 L8 1.6 A6.4 6.4 0 0 1 13.4 5.2 Z" fill="currentColor" />
    </svg>
  );
}
function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#8b8f88] dark:text-neutral-500">
      <path d="M5 11 L11 5 M6 5 h5 v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Corner() {
  return (
    <button type="button" aria-label="Открыть детали"
      className="absolute right-4 top-4 grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-black/[0.03] ring-1 ring-black/[0.04] transition hover:bg-black/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3C91E6] motion-reduce:transition-none dark:bg-white/[0.04] dark:ring-white/[0.06]">
      <Arrow />
    </button>
  );
}
function DeltaUp() {
  return <svg className="mb-2.5" width="11" height="11" viewBox="0 0 10 10" aria-hidden><path d="M5 1.5 L9 8 L1 8 Z" fill="#29BF12" /></svg>;
}
function DeltaDown() {
  return <svg className="mb-2.5" width="11" height="11" viewBox="0 0 10 10" aria-hidden><path d="M5 8.5 L1 2 L9 2 Z" fill="#F4442E" /></svg>;
}

export default function EmployeeSummary({
  base, totalAccrued, totalPaid, totalOut, totalPaidActual, paidByCur, fix, variable, monthly,
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
  const pctLabel = Math.round(pct * 100);

  // бусины полукруга 0..100
  const N = 17;
  const cx = 150, cy = 150, R = 120, br = 12;
  const beads = Array.from({ length: N }, (_, i) => {
    const frac = i / (N - 1);
    const t = Math.PI - frac * Math.PI;
    return { x: cx + R * Math.cos(t), y: cy - R * Math.sin(t), on: frac <= pct + 1e-9 };
  });

  // кумулятивные линии тренда
  let ca = 0, cp = 0;
  const cum = monthly.map((m) => { ca += m.accrued; cp += m.paid; return { ca, cp }; });
  const maxC = Math.max(1, ca);
  const n = cum.length;
  const xAt = (i: number) => (n > 1 ? 14 + (i / (n - 1)) * 250 : 140);
  const yAt = (v: number) => 116 - (v / maxC) * 96;
  const accLine = cum.map((c, i) => `${xAt(i).toFixed(1)},${yAt(c.ca).toFixed(1)}`).join(" ");
  const payLine = cum.map((c, i) => `${xAt(i).toFixed(1)},${yAt(c.cp).toFixed(1)}`).join(" ");
  const payArea = n ? `14,120 ${payLine} ${xAt(n - 1).toFixed(1)},120` : "";

  const okShare = fix.acc + variable.acc > 0 ? fix.acc / (fix.acc + variable.acc) : 0;
  const outShare = totalAccrued > 0 ? Math.round((totalOut / totalAccrued) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Ряд 1: гейдж-скор + тренд */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        {/* Скор-гейдж */}
        <div className={`${CARD} overflow-hidden p-6`}>
          <div className="flex items-center gap-2"><Pie /><span className={LABEL}>Оплачено начислений</span></div>
          <div className="relative mx-auto mt-1 h-[168px] w-[300px] max-w-full">
            <svg viewBox="0 0 300 172" className="h-full w-full">
              {beads.map((b, i) => (
                <circle key={i} cx={b.x} cy={b.y} r={br}
                  className={b.on ? "fill-[#29BF12]" : "fill-[#e6e8e1] dark:fill-white/[0.08]"} />
              ))}
            </svg>
            <div className="absolute inset-x-0 bottom-3 flex flex-col items-center">
              <div className={`text-[54px] font-light leading-none tracking-tight ${INK}`}>{pctLabel}<span className="text-[26px] text-[#9a9e95]">%</span></div>
              <div className="mt-1.5 flex items-center gap-1.5 rounded-full bg-black/[0.03] px-2.5 py-1 text-[12px] text-[#6f736c] ring-1 ring-black/[0.04] dark:bg-white/[0.05] dark:text-neutral-400 dark:ring-white/[0.06]">
                <span className={`h-1.5 w-1.5 rounded-full ${totalOut > 0 ? "bg-[#F4442E]" : "bg-[#29BF12]"}`} />
                {totalOut > 0 ? "есть долг" : "закрыто"}
              </div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 border-t border-black/[0.05] pt-4 dark:border-white/[0.06]">
            <Sub label="Начислено" value={formatMoney(totalAccrued, base)} />
            <Sub label="Выплачено" value={formatMoney(totalPaid, base)} tone="blue" />
            <Sub label="Остаток" value={formatMoney(totalOut, base)} tone={totalOut > 0 ? "red" : "green"} />
          </div>
        </div>

        {/* Тренд */}
        <div className={`${CARD} p-6`}>
          <Corner />
          <div className="flex items-center gap-2"><Pie /><span className={LABEL}>Динамика · начислено / выплачено</span></div>
          <div className={`mt-2 text-[40px] font-light leading-none tracking-tight ${INK}`}>{formatMoney(totalPaidActual, base)}</div>
          <div className="mt-1 text-[13px] text-[#9a9e95] dark:text-neutral-500">выплачено деньгами всего</div>
          <svg viewBox="0 0 300 150" preserveAspectRatio="none" className="mt-3 h-[150px] w-full">
            <defs>
              <linearGradient id="emptrend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#3C91E6" stopOpacity="0.13" />
                <stop offset="1" stopColor="#3C91E6" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* тонкая сетка (gridlines) */}
            {[26, 60, 94].map((gy) => (
              <line key={gy} x1="14" x2="286" y1={gy} y2={gy} stroke="#000" strokeOpacity="0.05" strokeWidth="1" className="dark:[stroke:#fff] dark:[stroke-opacity:0.06]" />
            ))}
            {payArea && <polygon points={payArea} fill="url(#emptrend)" />}
            <polyline points={accLine} fill="none" stroke="#c7c9c1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 6" className="dark:stroke-white/20" />
            <polyline points={payLine} fill="none" stroke="#3C91E6" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            {n > 0 && <circle cx={xAt(n - 1)} cy={yAt(cum[n - 1].cp)} r="4.5" fill="#3C91E6" />}
          </svg>
          <div className="mt-1 flex justify-between text-[11px] font-medium text-[#9a9e95] dark:text-neutral-600">
            {monthly.map((m) => <span key={m.ym}>{mLabel(m.ym)}</span>)}
          </div>
          {/* прямые подписи значений (direct labeling) */}
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] font-medium text-[#83877c] dark:text-neutral-400">
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full bg-[#3C91E6]" />выплачено <b className="font-semibold text-[#272727] dark:text-neutral-200">{formatMoney(totalPaid, base)}</b></span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full bg-[#c7c9c1] dark:bg-white/25" />начислено <b className="font-semibold text-[#272727] dark:text-neutral-200">{formatMoney(totalAccrued, base)}</b></span>
          </div>
        </div>
      </div>

      {/* Ряд 2: карточки-инсайты */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Insight label="Начислено" desc="Всего начислено за период" value={formatMoney(totalAccrued, base)} tint="blue" />
        <Insight label="Выплачено деньгами" desc="Ушло деньгами по операциям" value={formatMoney(totalPaidActual, base)} tint="green" delta="up"
          extra={<div className="mt-2 flex flex-wrap gap-1.5">{paidByCur.map(([cur, sum]) => <span key={cur} className="rounded-full bg-[#3C91E6]/10 px-2 py-0.5 text-[11px] font-medium text-[#3C91E6]">{formatMoney(sum, cur)}</span>)}</div>} />
        <Insight label="Остаток к выплате" desc={`${outShare}% ещё не выплачено`} value={formatMoney(totalOut, base)} tint={totalOut > 0 ? "red" : "green"} delta={totalOut > 0 ? "down" : "up"} />
        <Insight label="Структура" desc={`оклад ${Math.round(okShare * 100)}% · бонусы ${Math.round((1 - okShare) * 100)}%`} value={formatMoney(fix.acc + variable.acc, base)} tint="blue"
          extra={<div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/[0.06]"><div className="bg-[#3C91E6]" style={{ width: `${okShare * 100}%` }} /><div className="bg-[#c7c9c1] dark:bg-white/20" style={{ width: `${(1 - okShare) * 100}%` }} /></div>} />
      </div>
    </div>
  );
}

function Sub({ label, value, tone }: { label: string; value: string; tone?: "blue" | "green" | "red" }) {
  const c = tone === "blue" ? "text-[#3C91E6]" : tone === "green" ? "text-[#29BF12]" : tone === "red" ? "text-[#F4442E]" : "text-[#272727] dark:text-neutral-100";
  return (
    <div className="text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#a7aba2] dark:text-neutral-600">{label}</div>
      <div className={`mt-1 text-[15px] font-medium ${c}`}>{value}</div>
    </div>
  );
}

function Insight({ label, desc, value, tint, delta, extra }: {
  label: string; desc: string; value: string; tint: "blue" | "green" | "red"; delta?: "up" | "down"; extra?: ReactNode;
}) {
  const grad = tint === "green"
    ? "from-[#29BF12]/[0.09]"
    : tint === "red"
    ? "from-[#F4442E]/[0.08]"
    : "from-[#3C91E6]/[0.08]";
  return (
    <div className={`${CARD} flex min-h-[150px] flex-col overflow-hidden p-5`}>
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t ${grad} to-transparent`} />
      <Corner />
      <div className="relative flex items-center gap-2"><Pie /><span className="text-[13px] font-semibold text-[#3a3d34] dark:text-neutral-200">{label}</span></div>
      <div className="relative mt-1 max-w-[80%] text-[12px] leading-snug text-[#9a9e95] dark:text-neutral-500">{desc}</div>
      {extra}
      <div className="relative mt-auto flex items-end justify-end gap-1.5 pt-3">
        {delta === "up" && <DeltaUp />}
        {delta === "down" && <DeltaDown />}
        <span className={`text-[34px] font-light leading-none tracking-tight ${INK}`}>{value}</span>
      </div>
    </div>
  );
}
