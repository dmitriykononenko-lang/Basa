import type { ReactNode } from "react";
import { formatMoney } from "@/lib/format";

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function mLabel(ym: string, withYear: boolean) {
  const [y, m] = ym.split("-");
  const mon = MONTHS_RU[parseInt(m) - 1] ?? ym;
  return withYear ? `${mon} ${y}` : mon;
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
// Стрелка в углу плитки — якорь к блоку с подробностями ниже на странице.
function Corner({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} aria-label={label} title={label}
      className="absolute right-3 top-3 z-10 grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-black/[0.03] ring-1 ring-black/[0.04] transition hover:bg-black/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3C91E6] motion-reduce:transition-none dark:bg-white/[0.04] dark:ring-white/[0.06]">
      <Arrow />
    </a>
  );
}
function DeltaUp() {
  return <svg className="mb-2.5" width="11" height="11" viewBox="0 0 10 10" aria-hidden><path d="M5 1.5 L9 8 L1 8 Z" fill="#29BF12" /></svg>;
}
function DeltaDown() {
  return <svg className="mb-2.5" width="11" height="11" viewBox="0 0 10 10" aria-hidden><path d="M5 8.5 L1 2 L9 2 Z" fill="#F4442E" /></svg>;
}

export default function EmployeeSummary({
  base, totalAccrued, totalPaid, totalOut, totalPaidActual, paidByCur, fix, variable, other, monthly, hasPayouts, showCash, accruedByCur, outByCur, otherLabel,
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
  other: { acc: number; paid: number };
  monthly: MonthPoint[];
  hasPayouts: boolean;
  showCash: boolean;
  accruedByCur: [string, number][];
  outByCur: [string, number][];
  otherLabel: string;
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

  // Подписи месяцев: позиция совпадает с точкой линии; год — у первой точки и на смене года;
  // при большом числе месяцев показываем каждую k-ю (и последнюю), чтобы подписи не слипались.
  const step = Math.max(1, Math.ceil(n / 6));
  const ticks = monthly
    .map((m, i) => ({ m, i }))
    .filter(({ i }) => i % step === 0 || i === n - 1)
    .map(({ m, i }, k, arr) => {
      const prev = k > 0 ? arr[k - 1].m.ym.slice(0, 4) : null;
      return { ym: m.ym, i, text: mLabel(m.ym, prev === null || prev !== m.ym.slice(0, 4)) };
    });
  const firstYm = monthly[0]?.ym;
  const lastYm = monthly[n - 1]?.ym;

  const structTotal = fix.acc + variable.acc + other.acc;
  const share = (v: number) => (structTotal > 0 ? v / structTotal : 0);
  const okShare = share(fix.acc);
  const varShare = share(variable.acc);
  const otherShare = share(other.acc);
  const pctOf = (v: number) => `${Math.round(v * 100)}%`;
  const structDesc = [
    `оклад ${pctOf(okShare)}`,
    `бонусы ${pctOf(varShare)}`,
    ...(other.acc > 0 ? [`${otherLabel} ${pctOf(otherShare)}`] : []),
  ].join(" · ");
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
            <Sub label="Погашено начислений" value={formatMoney(totalPaid, base)} tone="blue" />
            <Sub label="Остаток" value={formatMoney(totalOut, base)} tone={totalOut > 0 ? "red" : "green"} />
          </div>
        </div>

        {/* Тренд */}
        <div className={`${CARD} p-6`}>
          <Corner href="#accruals" label="К начислениям по месяцам" />
          <div className="flex items-center gap-2 pr-10"><Pie /><span className={LABEL}>Динамика начислений · накопительно</span></div>
          <div className={`mt-2 break-words text-[28px] font-light leading-none tracking-tight tabular-nums sm:text-[40px] ${INK}`}>{formatMoney(totalPaid, base)}</div>
          <div className="mt-1 text-[13px] text-[#9a9e95] dark:text-neutral-500">погашено начислений из {formatMoney(totalAccrued, base)}</div>
          {n === 0 ? (
            <div className="mt-3 grid h-[150px] place-items-center rounded-2xl bg-black/[0.02] text-[13px] text-[#9a9e95] dark:bg-white/[0.03] dark:text-neutral-500">
              Нет начислений с месяцем — графику не из чего строиться
            </div>
          ) : (
          <>
          <svg viewBox="0 0 300 150" preserveAspectRatio="none" className="mt-3 h-[150px] w-full" role="img"
            aria-label={`Накопительно с ${mLabel(firstYm!, true)} по ${mLabel(lastYm!, true)}: начислено ${formatMoney(totalAccrued, base)}, погашено начислений ${formatMoney(totalPaid, base)}`}>
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
          <div className="relative mt-1 h-4 text-[11px] font-medium text-[#9a9e95] dark:text-neutral-500" aria-hidden>
            {ticks.map((t) => {
              const left = (xAt(t.i) / 300) * 100;
              const align = t.i === 0 && n > 1 ? "translate-x-0" : t.i === n - 1 && n > 1 ? "-translate-x-full" : "-translate-x-1/2";
              return <span key={t.ym} className={`absolute top-0 whitespace-nowrap ${align}`} style={{ left: `${left}%` }}>{t.text}</span>;
            })}
          </div>
          </>
          )}
          {/* прямые подписи значений (direct labeling) */}
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] font-medium text-[#83877c] dark:text-neutral-400">
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full bg-[#3C91E6]" />погашено начислений <b className="font-semibold text-[#272727] dark:text-neutral-200">{formatMoney(totalPaid, base)}</b></span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full bg-[#c7c9c1] dark:bg-white/25" />начислено <b className="font-semibold text-[#272727] dark:text-neutral-200">{formatMoney(totalAccrued, base)}</b></span>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-[#9a9e95] dark:text-neutral-500">
            Точка — накопительный итог на конец месяца начисления (по периоду начисления, не по дате выплаты). {showCash ? "Деньги по операциям — в плитке «Выплачено деньгами»." : ""}
          </p>
        </div>
      </div>

      {/* Ряд 2: карточки-инсайты */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Insight label="Начислено" desc="Всего начислено за всё время" value={formatMoney(totalAccrued, base)} tint="blue"
          href="#accruals" hrefLabel="К начислениям" extra={<CurChips list={accruedByCur} base={base} />} />
        {showCash ? (
          <Insight label="Выплачено деньгами" desc="Ушло деньгами по операциям (факт)" value={formatMoney(totalPaidActual, base)} tint="green" delta="up"
            href={hasPayouts ? "#payouts" : undefined} hrefLabel="К списку выплат" extra={<CurChips list={paidByCur} base={base} />} />
        ) : (
          <Insight label="Выплачено деньгами" desc="Доступно финансовой роли" value="—" tint="green" />
        )}
        <Insight label="Остаток к выплате" desc={`${outShare}% начисленного ещё не погашено`} value={formatMoney(totalOut, base)} tint={totalOut > 0 ? "red" : "green"} delta={totalOut > 0 ? "down" : "up"}
          href="#accruals" hrefLabel="К неоплаченным начислениям" extra={<CurChips list={outByCur} base={base} />} />
        <Insight label="Структура" desc={structDesc} value={formatMoney(structTotal, base)} tint="blue"
          extra={<div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/[0.06]" aria-hidden>
            <div className="bg-[#3C91E6]" style={{ width: `${okShare * 100}%` }} />
            <div className="bg-[#c7c9c1] dark:bg-white/20" style={{ width: `${varShare * 100}%` }} />
            <div className="bg-[#f2a65a]" style={{ width: `${otherShare * 100}%` }} />
          </div>} />
      </div>
    </div>
  );
}

function Sub({ label, value, tone }: { label: string; value: string; tone?: "blue" | "green" | "red" }) {
  const c = tone === "blue" ? "text-[#3C91E6]" : tone === "green" ? "text-[#29BF12]" : tone === "red" ? "text-[#F4442E]" : "text-[#272727] dark:text-neutral-100";
  return (
    <div className="text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#a7aba2] dark:text-neutral-600">{label}</div>
      <div className={`mt-1 break-words text-[13px] font-medium tabular-nums sm:text-[15px] ${c}`}>{value}</div>
    </div>
  );
}

// Суммы в исходных валютах — показываем, только если есть что-то кроме базовой валюты.
function CurChips({ list, base }: { list: [string, number][]; base: string }) {
  if (!list.some(([cur]) => cur !== base)) return null;
  return (
    <div className="relative mt-2 flex flex-wrap gap-1.5">
      {list.map(([cur, sum]) => (
        <span key={cur} className="rounded-full bg-[#3C91E6]/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-[#2f74b8] dark:text-[#7db8f0]">{formatMoney(sum, cur)}</span>
      ))}
    </div>
  );
}

function Insight({ label, desc, value, tint, delta, extra, href, hrefLabel }: {
  label: string; desc: string; value: string; tint: "blue" | "green" | "red"; delta?: "up" | "down"; extra?: ReactNode;
  href?: string; hrefLabel?: string;
}) {
  const grad = tint === "green"
    ? "from-[#29BF12]/[0.09]"
    : tint === "red"
    ? "from-[#F4442E]/[0.08]"
    : "from-[#3C91E6]/[0.08]";
  return (
    <div className={`${CARD} flex min-h-[150px] flex-col overflow-hidden p-5`}>
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t ${grad} to-transparent`} />
      {href && <Corner href={href} label={hrefLabel ?? label} />}
      <div className="relative flex items-center gap-2 pr-10"><Pie /><span className="text-[13px] font-semibold text-[#3a3d34] dark:text-neutral-200">{label}</span></div>
      <div className="relative mt-1 max-w-[80%] text-[12px] leading-snug text-[#9a9e95] dark:text-neutral-500">{desc}</div>
      {extra}
      <div className="relative mt-auto flex min-w-0 items-end justify-end gap-1.5 pt-3">
        {delta === "up" && <DeltaUp />}
        {delta === "down" && <DeltaDown />}
        <span className={`min-w-0 break-words text-right text-[26px] font-light leading-none tracking-tight tabular-nums sm:text-[30px] xl:text-[26px] 2xl:text-[32px] ${INK}`}>{value}</span>
      </div>
    </div>
  );
}
