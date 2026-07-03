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

const CARD = "rounded-3xl bg-white ring-1 ring-slate-200/70 shadow-[0_2px_8px_-2px_rgba(20,30,20,0.06),0_18px_40px_-24px_rgba(20,30,20,0.25)] dark:bg-[#15171c] dark:ring-white/[0.07] dark:shadow-none";
const LBL = "text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-500";

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

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className={LBL}>Начисления · к выплате</div>
        <div className="flex items-center gap-2">
          {projectRollup.length > 0 && (
            <button onClick={() => setRollupOpen((v) => !v)}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12.5px] font-medium text-slate-500 transition hover:text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-neutral-400">
              {rollupOpen ? "Скрыть свод" : "Свод по проектам"}
            </button>
          )}
          {paidCount > 0 && (
            <label className="flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12.5px] font-medium text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-neutral-400">
              <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand" />
              Показать оплаченные ({paidCount})
            </label>
          )}
        </div>
      </div>

      {rollupOpen && projectRollup.length > 0 && (
        <div className={`${CARD} overflow-hidden`}>
          <div className={`${LBL} border-b border-slate-100 px-6 py-3 dark:border-white/[0.06]`}>Переменная оплата по проектам (начислено)</div>
          <table className="w-full text-sm">
            <tbody>
              {projectRollup.map((r) => (
                <tr key={r.pid ?? r.name} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                  <td className="px-6 py-2.5 text-slate-700 dark:text-neutral-300">
                    {r.pid ? <Link href={`/projects/${r.pid}`} className="hover:text-brand hover:underline">{r.name}</Link> : r.name}
                  </td>
                  <td className="px-6 py-2.5 text-right font-semibold text-slate-800 tabular-nums dark:text-neutral-200">{formatMoney(r.val, base)}</td>
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
              <th className="px-6 pb-2.5 pt-4 text-left text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-neutral-500">Тип · за что</th>
              <th className="px-6 pb-2.5 pt-4 text-right text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-neutral-500">Начислено</th>
              <th className="px-6 pb-2.5 pt-4 text-right text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-neutral-500">Остаток</th>
              {manage && <th className="px-6" />}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const out = g.items.reduce((s, r) => s + r.outstanding, 0);
              const colSpan = manage ? 4 : 3;
              return (
                <Fragment key={g.ym}>
                  <tr>
                    <td colSpan={colSpan} className="px-6 pb-1.5 pt-3.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-400 dark:text-neutral-500">{g.ym === "—" ? "Без месяца" : monthLabel(g.ym)}</span>
                        {out > 0 && <span className="text-[11.5px] font-medium text-amber-600 dark:text-amber-400">остаток {formatMoney(out, base)}</span>}
                      </div>
                    </td>
                  </tr>
                  {g.items.map((o) => (
                    <AccrualLine key={o.id} o={o} manage={manage} userId={userId} teamId={teamId}
                      counterpartyId={counterpartyId} categories={categories} projects={projects} accounts={accounts} />
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <p className="px-6 pb-4 pt-2 text-[11.5px] leading-relaxed text-slate-400 dark:text-neutral-600">
          Показаны неоплаченные. Статус — точка слева от суммы. «Погасить» — отметить выплату, «Привязать» — связать с операцией; «⋯» — изменить/запланировать.
        </p>
      </div>
    </section>
  );
}

function StatusDot({ paid, amount, base }: { paid: number; amount: number; base: string }) {
  if (amount > 0 && paid >= amount) {
    return <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Погашено</span>;
  }
  if (paid > 0) {
    return <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-slate-500 dark:text-neutral-400"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Частично · {formatMoney(paid, base)}</span>;
  }
  return <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400 dark:text-neutral-500"><span className="h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-neutral-600" />Ожидает</span>;
}

function AccrualLine({
  o, manage, userId, teamId, counterpartyId, categories, projects, accounts,
}: {
  o: AccrualRow;
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
  const base = o.currency;
  const typeLabel = o.pay_part === "variable" ? "переменная" : "фиксированная";

  return (
    <tr className={`border-t border-slate-50 dark:border-white/[0.05] ${done ? "opacity-60" : "hover:bg-slate-50/70 dark:hover:bg-white/[0.02]"}`}>
      <td className="px-6 py-3.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {o.project_id && o.project_name ? (
            <Link href={`/projects/${o.project_id}`} className="font-semibold text-slate-800 hover:text-brand hover:underline dark:text-neutral-200">{o.project_name}</Link>
          ) : (
            <span className="font-semibold text-slate-800 dark:text-neutral-200">Оклад{o.note && o.note.includes("аванс") ? " (аванс)" : ""}</span>
          )}
          <span className="text-[12px] text-slate-400 dark:text-neutral-500">{typeLabel}</span>
          <StatusDot paid={o.paid} amount={o.amount} base={base} />
        </div>
      </td>
      <td className="whitespace-nowrap px-6 py-3.5 text-right font-medium text-slate-600 tabular-nums dark:text-neutral-400">{formatMoney(o.amount, o.currency)}</td>
      <td className={`whitespace-nowrap px-6 py-3.5 text-right font-semibold tabular-nums ${done ? "text-slate-400" : "text-amber-600 dark:text-amber-400"}`}>{formatMoney(o.outstanding, o.currency)}</td>
      {manage && (
        <td className="px-6 py-3.5 text-right">
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
              <button onClick={() => setMoreOpen((v) => !v)} title="Ещё: изменить, запланировать"
                className="rounded-full px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/[0.06]">⋯</button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}
