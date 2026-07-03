"use client";

import { useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { toBase } from "@/lib/fx";
import StatusBadge from "@/components/employee/StatusBadge";
import EditObligationForm from "@/components/EditObligationForm";
import PlanObligationButton from "@/components/PlanObligationButton";
import LinkPaymentButton from "@/components/LinkPaymentButton";
import PayObligationButton from "@/components/PayObligationButton";

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTHS_RU[parseInt(m) - 1]} ${y}`;
}

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
  rows,
  base,
  rates,
  manage,
  userId,
  teamId,
  counterpartyId,
  categories,
  projects,
  accounts,
  projectRollup,
}: {
  rows: AccrualRow[];
  base: string;
  rates: Record<string, number>;
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

  // группировка по месяцу (rows уже отсортированы по возрастанию)
  const groups: { ym: string; items: AccrualRow[] }[] = [];
  for (const r of display) {
    const ym = (r.period_month ?? r.due_date ?? "—").slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.ym === ym) last.items.push(r);
    else groups.push({ ym, items: [r] });
  }

  const eq = (minor: number, cur: string) => (cur === base ? null : toBase(minor, cur, rates));

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          Начисления (к выплате)
        </h2>
        <div className="flex items-center gap-3">
          {projectRollup.length > 0 && (
            <button
              onClick={() => setRollupOpen((v) => !v)}
              className="text-xs font-medium text-brand hover:underline"
            >
              {rollupOpen ? "Скрыть свод по проектам" : "Свод по проектам"}
            </button>
          )}
          {paidCount > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500 dark:text-neutral-400">
              <input
                type="checkbox"
                checked={showPaid}
                onChange={(e) => setShowPaid(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand"
              />
              Показать оплаченные ({paidCount})
            </label>
          )}
        </div>
      </div>

      {rollupOpen && projectRollup.length > 0 && (
        <div className="surface mb-3 overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-2 text-[11px] uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
            Переменная оплата по проектам (начислено)
          </div>
          <table className="w-full text-sm">
            <tbody>
              {projectRollup.map((r) => (
                <tr key={r.pid ?? r.name} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                  <td className="px-5 py-2 text-slate-700 dark:text-neutral-300">
                    {r.pid ? (
                      <Link href={`/projects/${r.pid}`} className="hover:text-brand hover:underline">{r.name}</Link>
                    ) : (
                      r.name
                    )}
                  </td>
                  <td className="px-5 py-2 text-right font-medium text-slate-800 dark:text-neutral-200">{formatMoney(r.val, base)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
              <th className="px-5 py-3 font-medium">Тип · за что</th>
              <th className="px-5 py-3 text-right font-medium">Начислено</th>
              <th className="px-5 py-3 text-right font-medium">Остаток</th>
              {manage && <th className="px-5 py-3 text-right font-medium">Действия</th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const accrued = g.items.reduce((s, r) => s + toBase(r.amount, r.currency, rates), 0);
              const out = g.items.reduce((s, r) => s + toBase(r.outstanding, r.currency, rates), 0);
              return (
                <MonthGroup
                  key={g.ym}
                  ym={g.ym}
                  items={g.items}
                  accrued={accrued}
                  out={out}
                  base={base}
                  eq={eq}
                  manage={manage}
                  userId={userId}
                  teamId={teamId}
                  counterpartyId={counterpartyId}
                  categories={categories}
                  projects={projects}
                  accounts={accounts}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-400 dark:text-neutral-600">
        Бейдж <b>Погашено / Частично / Ожидает</b> — статус оплаты начисления. <b>Привязать</b> — связать с
        существующей выплатой, <b>Погасить</b> — отметить выплату. Реже нужные <b>Изм.</b> / <b>Запланировать</b> — под «⋯».
      </p>
    </section>
  );
}

function MonthGroup({
  ym, items, accrued, out, base, eq, manage, userId, teamId, counterpartyId, categories, projects, accounts,
}: {
  ym: string;
  items: AccrualRow[];
  accrued: number;
  out: number;
  base: string;
  eq: (minor: number, cur: string) => number | null;
  manage: boolean;
  userId: string | null;
  teamId: string;
  counterpartyId: string;
  categories: Cat[];
  projects: Proj[];
  accounts: Acc[];
}) {
  const colSpan = manage ? 4 : 3;
  return (
    <>
      <tr className="bg-slate-50/70 dark:bg-white/[0.03]">
        <td colSpan={colSpan} className="px-5 py-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
              {ym === "—" ? "Без месяца" : monthLabel(ym)}
            </span>
            <span className="text-slate-400 dark:text-neutral-500">
              начислено {formatMoney(accrued, base)}
              {out > 0 && <span className="ml-2 text-amber-600 dark:text-amber-400">остаток {formatMoney(out, base)}</span>}
            </span>
          </div>
        </td>
      </tr>
      {items.map((o) => (
        <AccrualLine
          key={o.id}
          o={o}
          base={base}
          eq={eq}
          manage={manage}
          userId={userId}
          teamId={teamId}
          counterpartyId={counterpartyId}
          categories={categories}
          projects={projects}
          accounts={accounts}
        />
      ))}
    </>
  );
}

function AccrualLine({
  o, base, eq, manage, userId, teamId, counterpartyId, categories, projects, accounts,
}: {
  o: AccrualRow;
  base: string;
  eq: (minor: number, cur: string) => number | null;
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
  const amountEq = eq(o.amount, o.currency);
  const outEq = eq(o.outstanding, o.currency);
  const pct = o.amount > 0 ? Math.max(0, Math.min(1, o.paid / o.amount)) : 0;

  return (
    <tr className={`border-b border-slate-50 last:border-0 dark:border-white/[0.05] ${done ? "opacity-70" : ""}`}>
      <td className="px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">{o.pay_part === "variable" ? "переменная" : "фиксированная"}</span>
          {o.project_id && o.project_name && (
            <Link href={`/projects/${o.project_id}`} className="text-sm text-slate-700 hover:text-brand hover:underline dark:text-neutral-300">
              {o.project_name}
            </Link>
          )}
          <StatusBadge paid={o.paid} amount={o.amount} />
        </div>
        {!done && o.paid > 0 && (
          <div className="mt-1.5 h-1 w-32 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct * 100}%` }} />
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-right text-slate-700 dark:text-neutral-300">
        {formatMoney(o.amount, o.currency)}
        {amountEq != null && <div className="text-xs text-slate-400">≈ {formatMoney(amountEq, base)}</div>}
      </td>
      <td className={`whitespace-nowrap px-5 py-3 text-right font-medium ${done ? "text-slate-400" : "text-amber-600 dark:text-amber-400"}`}>
        {formatMoney(o.outstanding, o.currency)}
        {outEq != null && o.outstanding !== 0 && <div className="text-xs font-normal text-slate-400">≈ {formatMoney(outEq, base)}</div>}
      </td>
      {manage && (
        <td className="px-5 py-3 text-right">
          {userId && (
            <div className="flex items-center justify-end gap-1">
              <LinkPaymentButton
                obligationId={o.id}
                oblType="payable"
                counterpartyId={counterpartyId}
                currency={o.currency}
                outstanding={o.outstanding}
                teamId={teamId}
                userId={userId}
              />
              <PayObligationButton
                obligationId={o.id}
                userId={userId}
                outstanding={o.outstanding}
                currency={o.currency}
                teamId={teamId}
                counterpartyId={counterpartyId}
                accounts={accounts}
              />
              {moreOpen && (
                <>
                  <EditObligationForm
                    mode="accrual"
                    obligation={{
                      id: o.id,
                      type: "payable",
                      amount: o.amount,
                      currency: o.currency,
                      due_date: o.due_date,
                      period_month: o.period_month,
                      pay_part: o.pay_part,
                      project_id: o.project_id,
                      category_id: o.category_id,
                      note: o.note,
                      paid: o.paid,
                    }}
                    categories={categories}
                    projects={projects}
                  />
                  {!done && (
                    <PlanObligationButton
                      obligationId={o.id}
                      teamId={teamId}
                      userId={userId}
                      oblType="payable"
                      outstanding={o.outstanding}
                      currency={o.currency}
                      counterpartyId={counterpartyId}
                      categoryId={o.category_id}
                      projectId={o.project_id}
                      dueDate={o.due_date}
                      accounts={accounts}
                      alreadyScheduled={o.alreadyScheduled}
                    />
                  )}
                </>
              )}
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className="rounded-full px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/[0.06]"
                title="Ещё: изменить, запланировать"
              >
                ⋯
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}
