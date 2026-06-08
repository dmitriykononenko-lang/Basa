import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import type { SalaryRate } from "@/lib/salary";
import AccrueAllButton from "@/components/AccrueAllButton";
import PayrollRowActions from "@/components/PayrollRowActions";

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function periodStartMonth(period: string): { y: number; m: number } {
  const now = new Date();
  if (period === "month") return { y: now.getFullYear(), m: now.getMonth() };
  if (period === "quarter") return { y: now.getFullYear(), m: Math.floor(now.getMonth() / 3) * 3 };
  return { y: now.getFullYear(), m: 0 }; // year
}

type Obl = {
  id: string;
  counterparty_id: string | null;
  amount: number;
  paid: number;
  outstanding: number;
  currency: string;
  due_date: string | null;
  pay_part: "fixed" | "variable" | null;
  period_month: string | null;
};

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: p } = await searchParams;
  const period = p === "month" || p === "quarter" ? p : "year";

  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Зарплата</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }

  const { team, role } = current;
  const base = team.base_currency;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const manage = canEditFinance(role);

  // Ленивое авто-начисление зарплаты для сотрудников с включённым авто-режимом
  if (manage) await supabase.rpc("materialize_auto_accruals", { p_team: team.id });

  const start = periodStartMonth(period);
  const startStr = `${start.y}-${String(start.m + 1).padStart(2, "0")}-01`;

  const [{ data: employees }, { data: obls }, { data: fxRows }, { data: salaryRows }, { data: accounts }, { data: scheduledRows }] = await Promise.all([
    supabase.from("counterparties").select("id, name, department").eq("team_id", team.id).contains("kinds", ["employee"]).eq("archived", false).order("name"),
    supabase.from("obligation_balances").select("id, counterparty_id, amount, paid, outstanding, currency, due_date, pay_part, period_month").eq("team_id", team.id).eq("type", "payable").gte("period_month", startStr),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
    supabase.from("employee_salaries").select("counterparty_id, effective_from, amount, currency").eq("team_id", team.id).order("effective_from", { ascending: false }),
    supabase.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false).order("created_at"),
    supabase.from("transactions").select("obligation_id").eq("team_id", team.id).eq("status", "planned").not("obligation_id", "is", null),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);
  const emps = (employees ?? []) as { id: string; name: string; department: string | null }[];

  // Оклады по сотрудникам — для «Начислить всем за месяц»
  const salByEmp = new Map<string, SalaryRate[]>();
  for (const s of (salaryRows ?? []) as { counterparty_id: string; effective_from: string; amount: number; currency: string }[]) {
    const arr = salByEmp.get(s.counterparty_id) ?? [];
    arr.push({ effective_from: s.effective_from, amount: s.amount, currency: s.currency });
    salByEmp.set(s.counterparty_id, arr);
  }
  const employeesWithSalary = emps.map((e) => ({ id: e.id, name: e.name, salaries: salByEmp.get(e.id) ?? [] }));

  // Непогашенные начисления по сотрудникам — для «Выплатить/Запланировать»
  const outByEmp = new Map<string, { id: string; outstanding: number; currency: string; due_date: string | null }[]>();
  const scheduledOblIds = ((scheduledRows ?? []) as { obligation_id: string | null }[]).map((r) => r.obligation_id).filter(Boolean) as string[];

  // Список месяцев периода (от старта до текущего)
  const now = new Date();
  const months: string[] = [];
  {
    let y = start.y, m = start.m;
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth())) {
      months.push(`${y}-${String(m + 1).padStart(2, "0")}`);
      m++; if (m > 11) { m = 0; y++; }
    }
  }

  type Agg = { fixed: number; variable: number; paid: number; out: number; byMonth: Map<string, number> };
  const byEmp = new Map<string, Agg>();
  for (const e of emps) byEmp.set(e.id, { fixed: 0, variable: 0, paid: 0, out: 0, byMonth: new Map() });

  for (const o of (obls ?? []) as Obl[]) {
    if (!o.counterparty_id) continue;
    const agg = byEmp.get(o.counterparty_id);
    if (!agg) continue; // не сотрудник
    const v = toBase(o.amount, o.currency, rates);
    if (o.pay_part === "variable") agg.variable += v; else agg.fixed += v;
    agg.paid += toBase(o.paid, o.currency, rates);
    agg.out += toBase(o.outstanding, o.currency, rates);
    const ym = (o.period_month ?? "").slice(0, 7);
    if (ym) agg.byMonth.set(ym, (agg.byMonth.get(ym) ?? 0) + v);
    if (o.outstanding > 0) {
      const arr = outByEmp.get(o.counterparty_id) ?? [];
      arr.push({ id: o.id, outstanding: o.outstanding, currency: o.currency, due_date: o.due_date });
      outByEmp.set(o.counterparty_id, arr);
    }
  }

  // Группировка по отделам
  const deptMap = new Map<string, { id: string; name: string; agg: Agg }[]>();
  for (const e of emps) {
    const dep = e.department || "Без отдела";
    const arr = deptMap.get(dep) ?? [];
    arr.push({ id: e.id, name: e.name, agg: byEmp.get(e.id)! });
    deptMap.set(dep, arr);
  }
  const depts = [...deptMap.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"));

  // Итоги
  const grand = { fixed: 0, variable: 0, paid: 0, out: 0, byMonth: new Map<string, number>() };
  for (const a of byEmp.values()) {
    grand.fixed += a.fixed; grand.variable += a.variable; grand.paid += a.paid; grand.out += a.out;
    for (const ym of months) grand.byMonth.set(ym, (grand.byMonth.get(ym) ?? 0) + (a.byMonth.get(ym) ?? 0));
  }

  const PERIODS: [string, string][] = [["month", "Месяц"], ["quarter", "Квартал"], ["year", "Год"]];
  const monthLabel = (ym: string) => { const [, m] = ym.split("-"); return MONTHS_RU[parseInt(m) - 1]; };
  const cell = "whitespace-nowrap px-3 py-2.5 text-right tabular-nums";

  return (
    <div className="p-6 sm:p-8">
      <Link href="/employees" className="text-sm text-slate-400 hover:text-brand">← Сотрудники</Link>
      <header className="mb-5 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Зарплата</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Начисления по месяцам: оклад и бонус по всем сотрудникам, по отделам (в {base})
          </p>
        </div>
        {manage && employeesWithSalary.length > 0 && (
          <AccrueAllButton teamId={team.id} employees={employeesWithSalary} />
        )}
      </header>

      <div className="mb-6 inline-flex gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
        {PERIODS.map(([val, label]) => (
          <Link key={val} href={`/payroll?period=${val}`}
            className={`rounded-full px-4 py-1.5 font-medium transition ${period === val ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"}`}>
            {label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi title="Оклад (начислено)" value={formatMoney(grand.fixed, base)} />
        <Kpi title="Бонусы (начислено)" value={formatMoney(grand.variable, base)} />
        <Kpi title="Выплачено" value={formatMoney(grand.paid, base)} />
        <Kpi title="Остаток к выплате" value={formatMoney(grand.out, base)} accent={grand.out > 0 ? "amber" : "emerald"} />
      </div>

      {emps.length > 0 ? (
        <div className="mt-6 overflow-x-auto rounded-3xl bg-white ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="sticky left-0 bg-white px-5 py-3 text-left font-medium dark:bg-[#15171c]">Сотрудник</th>
                {months.map((ym) => <th key={ym} className="px-3 py-3 text-right font-medium">{monthLabel(ym)}</th>)}
                <th className="px-3 py-3 text-right font-medium">Оклад</th>
                <th className="px-3 py-3 text-right font-medium">Бонус</th>
                <th className="px-3 py-3 text-right font-medium">Выплачено</th>
                <th className="px-3 py-3 text-right font-medium">Остаток</th>
                {manage && <th className="px-3 py-3 text-right font-medium">Действия</th>}
              </tr>
            </thead>
              {depts.map(([dep, list]) => {
                const sub = { fixed: 0, variable: 0, paid: 0, out: 0, byMonth: new Map<string, number>() };
                for (const r of list) {
                  sub.fixed += r.agg.fixed; sub.variable += r.agg.variable; sub.paid += r.agg.paid; sub.out += r.agg.out;
                  for (const ym of months) sub.byMonth.set(ym, (sub.byMonth.get(ym) ?? 0) + (r.agg.byMonth.get(ym) ?? 0));
                }
                return (
                  <tbody key={dep}>
                    <tr className="bg-slate-50/70 dark:bg-white/[0.03]">
                      <td className="sticky left-0 bg-slate-50 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-[#191b21] dark:text-neutral-400">{dep}</td>
                      <td colSpan={months.length + (manage ? 5 : 4)} />
                    </tr>
                    {list.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50 dark:border-white/[0.04]">
                        <td className="sticky left-0 bg-white px-5 py-2.5 font-medium dark:bg-[#15171c]">
                          <Link href={`/employees/${r.id}`} className="text-slate-800 hover:text-brand dark:text-neutral-200">{r.name}</Link>
                        </td>
                        {months.map((ym) => {
                          const v = r.agg.byMonth.get(ym) ?? 0;
                          return <td key={ym} className={`${cell} text-slate-500 dark:text-neutral-400`}>{v ? formatMoney(v, base) : "—"}</td>;
                        })}
                        <td className={`${cell} text-slate-700 dark:text-neutral-300`}>{formatMoney(r.agg.fixed, base)}</td>
                        <td className={`${cell} text-slate-700 dark:text-neutral-300`}>{formatMoney(r.agg.variable, base)}</td>
                        <td className={`${cell} text-slate-700 dark:text-neutral-300`}>{formatMoney(r.agg.paid, base)}</td>
                        <td className={`${cell} font-semibold ${r.agg.out > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{formatMoney(r.agg.out, base)}</td>
                        {manage && (
                          <td className="whitespace-nowrap px-3 py-2.5 text-right">
                            {user && (
                              <PayrollRowActions
                                teamId={team.id}
                                userId={user.id}
                                counterpartyId={r.id}
                                obligations={outByEmp.get(r.id) ?? []}
                                accounts={accounts ?? []}
                                scheduledOblIds={scheduledOblIds}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                    <tr className="border-b border-slate-100 dark:border-white/[0.07]">
                      <td className="sticky left-0 bg-white px-5 py-2 text-xs font-semibold text-slate-400 dark:bg-[#15171c]">Итого «{dep}»</td>
                      {months.map((ym) => <td key={ym} className={`${cell} text-xs font-semibold text-slate-500`}>{sub.byMonth.get(ym) ? formatMoney(sub.byMonth.get(ym)!, base) : "—"}</td>)}
                      <td className={`${cell} text-xs font-semibold text-slate-600 dark:text-neutral-300`}>{formatMoney(sub.fixed, base)}</td>
                      <td className={`${cell} text-xs font-semibold text-slate-600 dark:text-neutral-300`}>{formatMoney(sub.variable, base)}</td>
                      <td className={`${cell} text-xs font-semibold text-slate-600 dark:text-neutral-300`}>{formatMoney(sub.paid, base)}</td>
                      <td className={`${cell} text-xs font-semibold text-slate-600 dark:text-neutral-300`}>{formatMoney(sub.out, base)}</td>
                      {manage && <td />}
                    </tr>
                  </tbody>
                );
              })}
            <tbody>
              <tr className="border-t-2 border-slate-200 dark:border-white/10">
                <td className="sticky left-0 bg-white px-5 py-3 text-base font-bold text-slate-900 dark:bg-[#15171c] dark:text-white">Всего</td>
                {months.map((ym) => <td key={ym} className={`${cell} font-bold text-slate-800 dark:text-neutral-100`}>{grand.byMonth.get(ym) ? formatMoney(grand.byMonth.get(ym)!, base) : "—"}</td>)}
                <td className={`${cell} font-bold text-slate-900 dark:text-white`}>{formatMoney(grand.fixed, base)}</td>
                <td className={`${cell} font-bold text-slate-900 dark:text-white`}>{formatMoney(grand.variable, base)}</td>
                <td className={`${cell} font-bold text-slate-900 dark:text-white`}>{formatMoney(grand.paid, base)}</td>
                <td className={`${cell} font-bold text-slate-900 dark:text-white`}>{formatMoney(grand.out, base)}</td>
                {manage && <td />}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Нет сотрудников. Добавьте их в разделе «Сотрудники».
        </p>
      )}
    </div>
  );
}

function Kpi({ title, value, accent }: { title: string; value: string; accent?: "amber" | "emerald" }) {
  const c = accent === "amber" ? "text-amber-600 dark:text-amber-400" : accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white";
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-2 text-lg font-bold ${c}`}>{value}</div>
    </div>
  );
}
