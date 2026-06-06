import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney, formatDate } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/constants";
import AddAccrualForm from "@/components/AddAccrualForm";
import SalaryEditor from "@/components/SalaryEditor";
import CopyField from "@/components/CopyField";
import EditEmployeePayment from "@/components/EditEmployeePayment";
import PayObligationButton from "@/components/PayObligationButton";

const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTHS_RU[parseInt(m) - 1]} ${y}`;
}

type Bal = {
  id: string;
  amount: number;
  paid: number;
  outstanding: number;
  currency: string;
  project_id: string | null;
  pay_part: "fixed" | "variable" | null;
  period_month: string | null;
  due_date: string | null;
};

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
  const { data: { user } } = await supabase.auth.getUser();

  const { data: emp } = await supabase
    .from("counterparties")
    .select("id, name, kind, employment_type, start_date, end_date, department, payout_currency, payment_method, legal_status, payee_name, inn, bank_account, bank_name, bik, wallet_address, wallet_network")
    .eq("id", id)
    .maybeSingle();
  if (!emp) notFound();

  const [{ data: bals }, { data: projects }, { data: accounts }, { data: salaries }] = await Promise.all([
    supabase
      .from("obligation_balances")
      .select("id, amount, paid, outstanding, currency, project_id, pay_part, period_month, due_date")
      .eq("team_id", team.id)
      .eq("type", "payable")
      .eq("counterparty_id", id),
    supabase.from("projects").select("id, name").eq("team_id", team.id).order("name"),
    supabase.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false).order("created_at"),
    supabase.from("employee_salaries").select("id, effective_from, amount, currency").eq("counterparty_id", id).order("effective_from", { ascending: false }),
  ]);
  const { data: positions } = await supabase
    .from("employee_positions").select("id, effective_from, position").eq("counterparty_id", id).order("effective_from", { ascending: false });
  const salaryRows = (salaries ?? []) as { id: string; effective_from: string; amount: number; currency: string }[];
  const positionRows = (positions ?? []) as { id: string; effective_from: string; position: string }[];
  const todayStr = new Date().toISOString().slice(0, 10);
  const currentPosition = positionRows.find((p) => p.effective_from <= todayStr)?.position ?? null;

  const rates = buildRateMap([], base); // курсы не критичны на карточке; суммы в валюте обязательства
  const projName = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const rows = (bals ?? []) as unknown as Bal[];

  let totalAccrued = 0, totalPaid = 0, totalOut = 0;
  type M = { fixed: number; variable: number; paid: number };
  const byMonth = new Map<string, M>();
  const variableByProject = new Map<string, number>();

  for (const o of rows) {
    const v = toBase(o.amount, o.currency, rates);
    totalAccrued += v;
    totalPaid += toBase(o.paid, o.currency, rates);
    totalOut += toBase(o.outstanding, o.currency, rates);
    const ym = (o.period_month ?? o.due_date ?? "").slice(0, 7) || "—";
    const m = byMonth.get(ym) ?? { fixed: 0, variable: 0, paid: 0 };
    if (o.pay_part === "variable") {
      m.variable += v;
      const pn = o.project_id ? projName.get(o.project_id) ?? "Проект" : "Без проекта";
      variableByProject.set(pn, (variableByProject.get(pn) ?? 0) + v);
    } else {
      m.fixed += v;
    }
    m.paid += toBase(o.paid, o.currency, rates);
    byMonth.set(ym, m);
  }

  const months = [...byMonth.keys()].filter((x) => x !== "—").sort().reverse();
  const projectRows = [...variableByProject.entries()].sort((a, b) => b[1] - a[1]);
  const manage = canEditFinance(role);

  return (
    <div className="p-6 sm:p-8">
      <Link href="/employees" className="text-sm text-slate-400 hover:text-brand">← Сотрудники</Link>
      <header className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{emp.name}</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            {currentPosition ?? (emp.employment_type ? EMPLOYMENT_TYPE_LABELS[emp.employment_type] ?? emp.employment_type : "Сотрудник")}
            {emp.department && ` · ${emp.department}`}
            {emp.start_date && ` · с ${formatDate(emp.start_date)}`}
            {emp.end_date && ` · уволен ${formatDate(emp.end_date)}`}
            {emp.payout_currency && ` · выплаты в ${emp.payout_currency}`}
          </p>
        </div>
        {manage && (
          <AddAccrualForm
            teamId={team.id}
            employeeId={emp.id}
            defaultCurrency={emp.payout_currency ?? base}
            projects={projects ?? []}
            salaries={salaryRows}
          />
        )}
      </header>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Kpi title="Начислено" value={formatMoney(totalAccrued, base)} />
        <Kpi title="Выплачено" value={formatMoney(totalPaid, base)} />
        <Kpi title="Остаток к выплате" value={formatMoney(totalOut, base)} accent={totalOut > 0 ? "amber" : "emerald"} />
      </div>

      {manage && user && (
        <div className="mb-6">
          <SalaryEditor
            teamId={team.id}
            userId={user.id}
            counterpartyId={emp.id}
            defaultCurrency={emp.payout_currency ?? base}
            salaries={salaryRows}
            positions={positionRows}
            endDate={emp.end_date ?? null}
            department={emp.department ?? null}
          />
        </div>
      )}

      {/* Реквизиты */}
      <section className="mb-6 rounded-3xl bg-white p-6 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Платёжные реквизиты
          </h2>
          {manage && (
            <EditEmployeePayment
              employeeId={emp.id}
              initial={{
                payment_method: emp.payment_method ?? "bank",
                legal_status: emp.legal_status ?? "",
                payee_name: emp.payee_name ?? "",
                inn: emp.inn ?? "",
                bank_account: emp.bank_account ?? "",
                bank_name: emp.bank_name ?? "",
                bik: emp.bik ?? "",
                wallet_address: emp.wallet_address ?? "",
                wallet_network: emp.wallet_network ?? "TRC20",
              }}
            />
          )}
        </div>
        <div className="mt-2 max-w-md text-sm">
          {emp.payment_method === "crypto" ? (
            <>
              <CopyField label="Кошелёк" value={emp.wallet_address ?? ""} />
              <CopyField label="Сеть" value={emp.wallet_network ?? ""} />
            </>
          ) : (
            <>
              <CopyField label="ФИО получателя" value={emp.payee_name ?? ""} />
              <CopyField label="Статус" value={emp.legal_status ?? ""} />
              <CopyField label="ИНН" value={emp.inn ?? ""} />
              <CopyField label="Р/С" value={emp.bank_account ?? ""} />
              <CopyField label="Банк" value={emp.bank_name ?? ""} />
              <CopyField label="БИК" value={emp.bik ?? ""} />
            </>
          )}
          {!emp.payee_name && !emp.bank_account && !emp.wallet_address && (
            <p className="text-slate-400 dark:text-neutral-500">Реквизиты не заполнены.</p>
          )}
        </div>
      </section>

      {/* Переменная по проектам */}
      {projectRows.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Переменная оплата по проектам (начислено)
          </h2>
          <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
            <table className="w-full text-sm">
              <tbody>
                {projectRows.map(([name, val]) => (
                  <tr key={name} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                    <td className="px-5 py-2.5 text-slate-700 dark:text-neutral-300">{name}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-slate-800 dark:text-neutral-200">{formatMoney(val, base)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* По месяцам */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
        По месяцам
      </h2>
      {months.length > 0 ? (
        <div className="mb-6 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                <th className="px-5 py-3 font-medium">Месяц</th>
                <th className="px-5 py-3 text-right font-medium">Фикс. начислено</th>
                <th className="px-5 py-3 text-right font-medium">Перем. начислено</th>
                <th className="px-5 py-3 text-right font-medium">Выплачено</th>
              </tr>
            </thead>
            <tbody>
              {months.map((ym) => {
                const m = byMonth.get(ym)!;
                return (
                  <tr key={ym} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                    <td className="px-5 py-3 font-medium text-slate-800 dark:text-neutral-200">{monthLabel(ym)}</td>
                    <td className="px-5 py-3 text-right text-slate-600 dark:text-neutral-400">{formatMoney(m.fixed, base)}</td>
                    <td className="px-5 py-3 text-right text-slate-600 dark:text-neutral-400">{formatMoney(m.variable, base)}</td>
                    <td className="px-5 py-3 text-right text-slate-600 dark:text-neutral-400">{formatMoney(m.paid, base)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-6 rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Нет начислений. Нажмите «Начислить».
        </p>
      )}

      {/* Начисления и выплаты */}
      {rows.length > 0 && (
        <>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Начисления (к выплате)
          </h2>
          <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
            <table className="w-full text-sm">
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                    <td className="px-5 py-3 text-slate-700 dark:text-neutral-300">
                      {o.period_month ? monthLabel(o.period_month.slice(0, 7)) : "—"}
                      <span className="ml-2 text-xs text-slate-400">
                        {o.pay_part === "variable" ? "переменная" : "фиксированная"}
                        {o.project_id && projName.get(o.project_id) ? ` · ${projName.get(o.project_id)}` : ""}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-800 dark:text-neutral-200">
                      {formatMoney(o.outstanding, o.currency)}
                      {o.outstanding !== o.amount && (
                        <span className="ml-1 text-xs font-normal text-slate-400">из {formatMoney(o.amount, o.currency)}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {manage && user && (
                        <PayObligationButton
                          obligationId={o.id}
                          userId={user.id}
                          outstanding={o.outstanding}
                          currency={o.currency}
                          teamId={team.id}
                          counterpartyId={emp.id}
                          accounts={accounts ?? []}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-400 dark:text-neutral-600">
            «Погасить» = выплата сотруднику (уменьшает остаток и кредиторку в отчёте по долгам).
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ title, value, accent }: { title: string; value: string; accent?: "amber" | "emerald" }) {
  const color = accent === "amber" ? "text-amber-600 dark:text-amber-400" : accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white";
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-2 text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}
