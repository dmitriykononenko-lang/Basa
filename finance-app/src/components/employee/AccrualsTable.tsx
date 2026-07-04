"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import EditObligationForm from "@/components/EditObligationForm";
import PlanObligationButton from "@/components/PlanObligationButton";
import LinkPaymentButton from "@/components/LinkPaymentButton";
import PayObligationButton from "@/components/PayObligationButton";

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTHS_RU[parseInt(m) - 1] ?? m} ${y}`;
}

// Дизайн-система референса (Manrope наследуется от обёртки страницы):
// синий #3C91E6 · зелёный #29BF12 · красный #F4442E · текст #272727 · near-white карточки.
const CARD = "rounded-[26px] bg-[#fbfcf9] ring-1 ring-black/[0.05] shadow-[0_1px_2px_rgba(20,25,15,0.04),0_16px_34px_-22px_rgba(20,25,15,0.20)] dark:bg-[#191d19] dark:ring-white/[0.06] dark:shadow-none";
const LABEL = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#82867b] dark:text-neutral-500";
const PILL = "rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1.5 text-[12.5px] font-medium text-[#6f736c] transition hover:text-[#272727] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-neutral-400";

export type AccrualRow = {
  id: string;
  amount: number;
  paid: number;
  outstanding: number;
  currency: string;
  project_id: string | null;
  project_name: string | null;
  pay_part: "fixed" | "variable" | null;
  period_month: string | null;
  due_date: string | null;
  note: string | null;
  category_id: string | null;
  alreadyScheduled: boolean;
};

type Cat = { id: string; name: string; kind: string };
type Proj = { id: string; name: string };
type Acc = { id: string; name: string; currency: string };

export default function AccrualsTable({
  rows, base, manage, userId, teamId, counterpartyId, categories, projects, accounts, projectRollup,
}: {
  rows: AccrualRow[];
  base: string;
  manage: boolean;
  userId: string | null;
  teamId: string;
  counterpartyId: string;
  categories: Cat[];
  projects: Proj[];
  accounts: Acc[];
  projectRollup: { pid: string | null; name: string; val: number }[];
}) {
  const paidCount = rows.filter((r) => r.outstanding <= 0).length;
  const [showPaid, setShowPaid] = useState(false);
  const [rollupOpen, setRollupOpen] = useState(false);

  const display = showPaid ? rows : rows.filter((r) => r.outstanding > 0);
  const groups: { ym: string; items: AccrualRow[] }[] = [];
  for (const r of display) {
    const ym = (r.period_month ?? r.due_date ?? "—").slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.ym === ym) last.items.push(r);
    else groups.push({ ym, items: [r] });
  }
  const colSpan = manage ? 4 : 3;

  return (
    <section className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className={LABEL}>Начисления · к выплате</div>
        <div className="flex items-center gap-2">
          {projectRollup.length > 0 && (
            <button onClick={() => setRollupOpen((v) => !v)} className={PILL}>
              {rollupOpen ? "Скрыть свод" : "Свод по проектам"}
            </button>
          )}
          {paidCount > 0 && (
            <label className={`flex cursor-pointer items-center gap-2 ${PILL}`}>
              <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-[#3C91E6] focus:ring-[#3C91E6]" />
              Показать оплаченные ({paidCount})
            </label>
          )}
        </div>
      </div>

      {rollupOpen && projectRollup.length > 0 && (
        <div className={`${CARD} overflow-hidden`}>
          <div className={`${LABEL} border-b border-black/[0.05] px-6 py-3 dark:border-white/[0.06]`}>Переменная оплата по проектам (начислено)</div>
          <table className="w-full text-sm">
            <tbody>
              {projectRollup.map((r) => (
                <tr key={r.pid ?? r.name} className="border-b border-black/[0.04] last:border-0 dark:border-white/[0.05]">
                  <td className="px-6 py-2.5 text-[#3a3d34] dark:text-neutral-300">
                    {r.pid ? <Link href={`/projects/${r.pid}`} className="hover:text-[#3C91E6] hover:underline">{r.name}</Link> : r.name}
                  </td>
                  <td className="px-6 py-2.5 text-right font-semibold tabular-nums text-[#272727] dark:text-neutral-200">{formatMoney(r.val, base)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={`${CARD} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={`px-6 pb-3 pt-5 text-left ${LABEL}`}>Тип · за что</th>
              <th className={`px-6 pb-3 pt-5 text-right ${LABEL}`}>Начислено</th>
              <th className={`px-6 pb-3 pt-5 text-right ${LABEL}`}>Остаток</th>
              {manage && <th className="px-6" />}
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) => {
              const out = g.items.reduce((s, r) => s + r.outstanding, 0);
              return (
                <Fragment key={g.ym}>
                  {/* разделитель + шапка месяца */}
                  <tr>
                    <td colSpan={colSpan} className={`bg-black/[0.015] px-6 py-2.5 dark:bg-white/[0.03] ${gi > 0 ? "border-t-4 border-[#fbfcf9] dark:border-[#0f120f]" : ""}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#6f736c] dark:text-neutral-400">{g.ym === "—" ? "Без месяца" : monthLabel(g.ym)}</span>
                        {out > 0 && <span className="text-[12px] font-semibold tabular-nums text-[#F4442E]">остаток {formatMoney(out, base)}</span>}
                      </div>
                    </td>
                  </tr>
                  {g.items.map((o) => (
                    <AccrualLine key={o.id} o={o} base={base} manage={manage} userId={userId} teamId={teamId}
                      counterpartyId={counterpartyId} categories={categories} projects={projects} accounts={accounts} />
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-1 text-[11.5px] leading-relaxed text-[#9a9e95] dark:text-neutral-600">
        Показаны неоплаченные. Статус — точка слева. «Погасить» — отметить выплату, «Привязать» — связать с операцией; «⋯» — изменить/запланировать.
      </p>
    </section>
  );
}

function StatusDot({ paid, amount, base }: { paid: number; amount: number; base: string }) {
  if (amount > 0 && paid >= amount) {
    return <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#82867b]"><span className="h-1.5 w-1.5 rounded-full bg-[#29BF12]" />Погашено</span>;
  }
  if (paid > 0) {
    return <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#6f736c] dark:text-neutral-400"><span className="h-1.5 w-1.5 rounded-full bg-[#3C91E6]" />Частично · {formatMoney(paid, base)}</span>;
  }
  return <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#9a9e95] dark:text-neutral-500"><span className="h-1.5 w-1.5 rounded-full bg-[#cfd2c9] dark:bg-neutral-600" />Ожидает</span>;
}

function AccrualLine({
  o, base, manage, userId, teamId, counterpartyId, categories, projects, accounts,
}: {
  o: AccrualRow;
  base: string;
  manage: boolean;
  userId: string | null;
  teamId: string;
  counterpartyId: string;
  categories: Cat[];
  projects: Proj[];
  accounts: Acc[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const done = o.outstanding <= 0;
  const typeLabel = o.pay_part === "variable" ? "переменная" : "фиксированная";

  return (
    <tr className={`border-t border-black/[0.05] transition dark:border-white/[0.05] ${done ? "opacity-60" : "hover:bg-black/[0.015] dark:hover:bg-white/[0.02]"}`}>
      <td className="px-6 py-4">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {o.project_id && o.project_name ? (
            <Link href={`/projects/${o.project_id}`} className="font-semibold text-[#272727] hover:text-[#3C91E6] hover:underline dark:text-neutral-100">{o.project_name}</Link>
          ) : (
            <span className="font-semibold text-[#272727] dark:text-neutral-100">Оклад{o.note && o.note.includes("аванс") ? " (аванс)" : ""}</span>
          )}
          <span className="text-[12px] text-[#a7aba2] dark:text-neutral-500">{typeLabel}</span>
          <StatusDot paid={o.paid} amount={o.amount} base={base} />
        </div>
      </td>
      <td className="whitespace-nowrap px-6 py-4 text-right font-light tabular-nums text-[#6f736c] dark:text-neutral-400">{formatMoney(o.amount, o.currency)}</td>
      <td className={`whitespace-nowrap px-6 py-4 text-right font-medium tabular-nums ${done ? "text-[#a7aba2] dark:text-neutral-600" : "text-[#272727] dark:text-neutral-100"}`}>{formatMoney(o.outstanding, o.currency)}</td>
      {manage && (
        <td className="px-6 py-4 text-right">
          {userId && (
            <div className="flex items-center justify-end gap-1">
              <LinkPaymentButton obligationId={o.id} oblType="payable" counterpartyId={counterpartyId} currency={o.currency} outstanding={o.outstanding} teamId={teamId} userId={userId} />
              <PayObligationButton obligationId={o.id} userId={userId} outstanding={o.outstanding} currency={o.currency} teamId={teamId} counterpartyId={counterpartyId} accounts={accounts} />
              {moreOpen && (
                <>
                  <EditObligationForm mode="accrual"
                    obligation={{ id: o.id, type: "payable", amount: o.amount, currency: o.currency, due_date: o.due_date, period_month: o.period_month, pay_part: o.pay_part, project_id: o.project_id, category_id: o.category_id, note: o.note, paid: o.paid }}
                    categories={categories} projects={projects} />
                  {!done && (
                    <PlanObligationButton obligationId={o.id} teamId={teamId} userId={userId} oblType="payable" outstanding={o.outstanding} currency={o.currency}
                      counterpartyId={counterpartyId} categoryId={o.category_id} projectId={o.project_id} dueDate={o.due_date} accounts={accounts} alreadyScheduled={o.alreadyScheduled} />
                  )}
                </>
              )}
              <button onClick={() => setMoreOpen((v) => !v)} title="Ещё: изменить, запланировать" aria-label="Ещё действия"
                className="cursor-pointer rounded-full px-2 py-1 text-xs text-[#a7aba2] transition hover:bg-black/[0.04] hover:text-[#6f736c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3C91E6] dark:hover:bg-white/[0.06]">⋯</button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}
