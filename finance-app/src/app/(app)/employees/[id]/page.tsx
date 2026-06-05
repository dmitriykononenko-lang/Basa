import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney, formatDate } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/constants";
import AddAccrualForm from "@/components/AddAccrualForm";

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTHS_RU[parseInt(m) - 1]} ${y}`;
}

export default async function EmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const current = await getCurrentTeam();
  if (!current) notFound();
  const { team, role } = current;
  const base = team.base_currency;
  const supabase = await createClient();

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name, employment_type, start_date, payout_currency, status, note")
    .eq("id", id)
    .maybeSingle();
  if (!emp) notFound();

  const [{ data: accruals }, { data: pays }, { data: fxRows }] = await Promise.all([
    supabase
      .from("payroll_accruals")
      .select("period_month, kind, amount, currency")
      .eq("employee_id", id)
      .order("period_month", { ascending: false }),
    supabase
      .from("transactions")
      .select("amount, currency, occurred_on, pay_part")
      .eq("team_id", team.id)
      .eq("employee_id", id)
      .eq("type", "expense"),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);

  type M = { fixed: number; variable: number; paid: number };
  const byMonth = new Map<string, M>();
  function bucket(ym: string): M {
    let m = byMonth.get(ym);
    if (!m) { m = { fixed: 0, variable: 0, paid: 0 }; byMonth.set(ym, m); }
    return m;
  }

  let totalAccrued = 0;
  let totalPaid = 0;
  for (const a of accruals ?? []) {
    const ym = a.period_month.slice(0, 7);
    const v = toBase(a.amount, a.currency, rates);
    if (a.kind === "fixed") bucket(ym).fixed += v;
    else bucket(ym).variable += v;
    totalAccrued += v;
  }
  for (const p of pays ?? []) {
    const ym = p.occurred_on.slice(0, 7);
    const v = toBase(p.amount, p.currency, rates);
    bucket(ym).paid += v;
    totalPaid += v;
  }

  const months = [...byMonth.keys()].sort().reverse();
  const balance = totalAccrued - totalPaid;

  return (
    <div className="p-6 sm:p-8">
      <Link href="/employees" className="text-sm text-slate-400 hover:text-brand">← Сотрудники</Link>
      <header className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{emp.name}</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            {EMPLOYMENT_TYPE_LABELS[emp.employment_type] ?? emp.employment_type}
            {emp.start_date && ` · с ${formatDate(emp.start_date)}`}
            {` · выплаты в ${emp.payout_currency}`}
          </p>
        </div>
        {canEditFinance(role) && (
          <AddAccrualForm teamId={team.id} employeeId={emp.id} defaultCurrency={emp.payout_currency} />
        )}
      </header>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Kpi title="Начислено" value={formatMoney(totalAccrued, base)} />
        <Kpi title="Выплачено" value={formatMoney(totalPaid, base)} />
        <Kpi title="Остаток к выплате" value={formatMoney(balance, base)} accent={balance > 0 ? "amber" : "emerald"} />
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
        По месяцам
      </h2>
      {months.length > 0 ? (
        <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-neutral-800 dark:text-neutral-500">
                <th className="px-5 py-3 font-medium">Месяц</th>
                <th className="px-5 py-3 text-right font-medium">Фикс. начислено</th>
                <th className="px-5 py-3 text-right font-medium">Перем. начислено</th>
                <th className="px-5 py-3 text-right font-medium">Выплачено</th>
                <th className="px-5 py-3 text-right font-medium">Δ месяца</th>
              </tr>
            </thead>
            <tbody>
              {months.map((ym) => {
                const m = byMonth.get(ym)!;
                const delta = m.fixed + m.variable - m.paid;
                return (
                  <tr key={ym} className="border-b border-slate-50 last:border-0 dark:border-neutral-800/60">
                    <td className="px-5 py-3 font-medium text-slate-800 dark:text-neutral-200">{monthLabel(ym)}</td>
                    <td className="px-5 py-3 text-right text-slate-600 dark:text-neutral-400">{formatMoney(m.fixed, base)}</td>
                    <td className="px-5 py-3 text-right text-slate-600 dark:text-neutral-400">{formatMoney(m.variable, base)}</td>
                    <td className="px-5 py-3 text-right text-slate-600 dark:text-neutral-400">{formatMoney(m.paid, base)}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${delta > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                      {formatMoney(delta, base)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-800">
          Нет начислений и выплат. Нажмите «Начислить», а выплаты отмечайте в операциях
          (расход с привязкой к сотруднику).
        </p>
      )}
    </div>
  );
}

function Kpi({ title, value, accent }: { title: string; value: string; accent?: "amber" | "emerald" }) {
  const color = accent === "amber" ? "text-amber-600 dark:text-amber-400" : accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white";
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-2 text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}
