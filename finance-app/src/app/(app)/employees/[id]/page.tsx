import Link from "next/link";
import { Manrope } from "next/font/google";
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
import EmployeeSummary from "@/components/employee/EmployeeSummary";
import AccrualsTable, { type AccrualRow } from "@/components/employee/AccrualsTable";
import { effectiveDue, businessDaysBetween, workdaysLabel } from "@/lib/workdays";

// Шрифт карточки — Manrope (геометрический, с кириллицей и весом 300; Urbanist кириллицу не покрывает)
const manrope = Manrope({ subsets: ["latin", "cyrillic"], weight: ["300", "400", "500", "600", "700"], display: "swap" });

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
  note: string | null;
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
    .select("id, name, kind, employment_type, start_date, end_date, department, auto_accrue, payout_currency, payment_method, legal_status, payee_name, inn, bank_account, bank_name, bik, wallet_address, wallet_network")
    .eq("id", id)
    .maybeSingle();
  if (!emp) notFound();

  const [{ data: bals }, { data: projects }, { data: accounts }, { data: salaries }, { data: fxRows }] = await Promise.all([
    supabase
      .from("obligation_balances")
      .select("id, amount, paid, outstanding, currency, project_id, pay_part, period_month, due_date, note")
      .eq("team_id", team.id)
      .eq("type", "payable")
      .eq("counterparty_id", id),
    supabase.from("projects").select("id, name").eq("team_id", team.id).order("name"),
    supabase.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false).order("created_at"),
    supabase.from("employee_salaries").select("id, effective_from, amount, currency").eq("counterparty_id", id).order("effective_from", { ascending: false }),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);
  const { data: positions } = await supabase
    .from("employee_positions").select("id, effective_from, position").eq("counterparty_id", id).order("effective_from", { ascending: false });
  // Проекты в работе, где сотрудник — ответственный (аналитик)
  const { data: activeProjects } = await supabase
    .from("projects")
    .select("id, name, start_date, plan_work_days, due_date")
    .eq("team_id", team.id)
    .eq("responsible_counterparty_id", id)
    .eq("status", "active")
    .eq("archived", false)
    .order("start_date", { ascending: true });
  const { data: expenseCats } = await supabase
    .from("categories").select("id, name, kind").eq("team_id", team.id).eq("kind", "expense").eq("archived", false).order("name");
  // Категория начисления (вью obligation_balances её не отдаёт) + уже запланированные платежи
  const { data: oblMetaRows } = await supabase
    .from("obligations").select("id, category_id").eq("team_id", team.id).eq("counterparty_id", id);
  const oblCatId = new Map(((oblMetaRows ?? []) as { id: string; category_id: string | null }[]).map((o) => [o.id, o.category_id]));
  const { data: scheduledRows } = await supabase
    .from("transactions").select("obligation_id").eq("team_id", team.id).eq("status", "planned").not("obligation_id", "is", null);
  const scheduledOblIds = new Set(
    ((scheduledRows ?? []) as { obligation_id: string | null }[]).map((r) => r.obligation_id).filter(Boolean) as string[]
  );
  // Фактические выплаты — расходные операции этому контрагенту, независимо от начислений
  const { data: payouts } = await supabase
    .from("transactions")
    .select("id, occurred_on, amount, currency, project_id, note, account:accounts!transactions_account_id_fkey(name)")
    .eq("team_id", team.id)
    .eq("counterparty_id", id)
    .eq("type", "expense")
    .eq("status", "actual")
    .order("occurred_on", { ascending: true })
    .limit(500);
  const salaryRows = (salaries ?? []) as { id: string; effective_from: string; amount: number; currency: string }[];
  const positionRows = (positions ?? []) as { id: string; effective_from: string; position: string }[];
  const todayStr = new Date().toISOString().slice(0, 10);
  const currentPosition = positionRows.find((p) => p.effective_from <= todayStr)?.position ?? null;

  // Реальные курсы валют (USDT→RUB и т.п.) — иначе мультивалютные суммы считались 1:1
  const rates = buildRateMap(fxRows ?? [], base);
  const projName = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const rows = ((bals ?? []) as unknown as Bal[]).slice().sort((a, b) =>
    ((a.period_month ?? a.due_date ?? "") as string).localeCompare((b.period_month ?? b.due_date ?? "") as string)
  );

  let totalAccrued = 0, totalPaid = 0, totalOut = 0;
  const fix = { acc: 0, paid: 0 };
  const variable = { acc: 0, paid: 0 };
  const monthMap = new Map<string, { accrued: number; paid: number }>();
  const variableByProject = new Map<string, { name: string; val: number }>();
  for (const o of rows) {
    const a = toBase(o.amount, o.currency, rates);
    const p = toBase(o.paid, o.currency, rates);
    totalAccrued += a;
    totalPaid += p;
    totalOut += toBase(o.outstanding, o.currency, rates);
    const ym = (o.period_month ?? o.due_date ?? "—").slice(0, 7);
    const mm = monthMap.get(ym) ?? { accrued: 0, paid: 0 };
    mm.accrued += a; mm.paid += p; monthMap.set(ym, mm);
    if (o.pay_part === "variable") {
      variable.acc += a; variable.paid += p;
      const pkey = o.project_id ?? "";
      const pn = o.project_id ? projName.get(o.project_id) ?? "Проект" : "Без проекта";
      const cur = variableByProject.get(pkey) ?? { name: pn, val: 0 };
      cur.val += a;
      variableByProject.set(pkey, cur);
    } else {
      fix.acc += a; fix.paid += p;
    }
  }
  const monthly = [...monthMap.entries()]
    .filter(([k]) => k !== "—")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, v]) => ({ ym, accrued: v.accrued, paid: v.paid }));
  const initials = String(emp.name).split(/\s+/).filter(Boolean).slice(0, 2).map((s: string) => s[0]).join("").toUpperCase() || "?";

  const payoutRows = (payouts ?? []) as unknown as {
    id: string; occurred_on: string; amount: number; currency: string;
    project_id: string | null; note: string | null; account: { name: string } | null;
  }[];
  let totalPaidActual = 0;
  const paidByCur = new Map<string, number>();
  for (const p of payoutRows) {
    totalPaidActual += toBase(p.amount, p.currency, rates);
    paidByCur.set(p.currency, (paidByCur.get(p.currency) ?? 0) + p.amount);
  }
  const curChips = [...paidByCur.entries()];

  const projectRows = [...variableByProject.entries()]
    .map(([pid, x]) => ({ pid: pid || null, name: x.name, val: x.val }))
    .sort((a, b) => b.val - a.val);
  const manage = canEditFinance(role);

  // сверка «закрыто начислений» vs «выплачено деньгами»
  const diff = totalPaidActual - totalPaid;
  const reconciled = Math.abs(diff) < 100; // разница < 1 ₽ считаем сходящейся

  const accrualRows: AccrualRow[] = rows.map((o) => ({
    id: o.id,
    amount: o.amount,
    paid: o.paid,
    outstanding: o.outstanding,
    currency: o.currency,
    project_id: o.project_id,
    project_name: o.project_id ? projName.get(o.project_id) ?? null : null,
    pay_part: o.pay_part,
    period_month: o.period_month,
    due_date: o.due_date,
    note: o.note,
    category_id: oblCatId.get(o.id) ?? null,
    alreadyScheduled: scheduledOblIds.has(o.id),
  }));

  return (
    <div className={`${manrope.className} p-6 sm:p-8`}>
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
            categories={(expenseCats ?? []) as { id: string; name: string; kind: string }[]}
            startDate={emp.start_date ?? null}
            endDate={emp.end_date ?? null}
          />
        )}
      </header>

      {/* Сводка */}
      <div className="mb-4">
        <EmployeeSummary
          base={base}
          initials={initials}
          totalAccrued={totalAccrued}
          totalPaid={totalPaid}
          totalOut={totalOut}
          totalPaidActual={totalPaidActual}
          paidByCur={curChips}
          fix={fix}
          variable={variable}
          monthly={monthly}
        />
      </div>

      {/* Сверка — только если расходится */}
      {payoutRows.length > 0 && !reconciled && (
        <div className="mb-6 rounded-2xl bg-amber-50/60 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40">
          Расхождение {formatMoney(Math.abs(diff), base)}: закрыто начислений {formatMoney(totalPaid, base)}, выплачено деньгами {formatMoney(totalPaidActual, base)}. Обычно это погашения без операции или непривязанные выплаты.
        </div>
      )}

      {/* Начисления (к выплате) — главная рабочая таблица */}
      {accrualRows.length > 0 ? (
        <AccrualsTable
          rows={accrualRows}
          base={base}
          manage={manage}
          userId={user?.id ?? null}
          teamId={team.id}
          counterpartyId={emp.id}
          categories={(expenseCats ?? []) as { id: string; name: string; kind: string }[]}
          projects={projects ?? []}
          accounts={accounts ?? []}
          projectRollup={projectRows}
        />
      ) : (
        <p className="mb-6 rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Нет начислений. Нажмите «Начислить».
        </p>
      )}

      {/* Фактические выплаты (операции) */}
      {payoutRows.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
              Выплаты (операции)
            </h2>
            <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">
              Всего: {formatMoney(totalPaidActual, base)}
            </span>
          </div>
          <div className="surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                  <th className="px-5 py-3 font-medium">Дата</th>
                  <th className="px-5 py-3 font-medium">Проект · описание</th>
                  <th className="px-5 py-3 font-medium">Счёт</th>
                  <th className="px-5 py-3 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {payoutRows.map((p) => {
                  const pn = p.project_id ? projName.get(p.project_id) : null;
                  const eq = p.currency === base ? null : toBase(p.amount, p.currency, rates);
                  return (
                    <tr key={p.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600 dark:text-neutral-400">{formatDate(p.occurred_on)}</td>
                      <td className="px-5 py-3 text-slate-700 dark:text-neutral-300">
                        {pn && (
                          p.project_id ? (
                            <Link href={`/projects/${p.project_id}`} className="font-medium text-slate-800 hover:text-brand hover:underline dark:text-neutral-200">{pn}</Link>
                          ) : (
                            <span className="font-medium text-slate-800 dark:text-neutral-200">{pn}</span>
                          )
                        )}
                        {p.note && <span className={pn ? "ml-2 text-xs text-slate-400" : ""}>{p.note}</span>}
                        {!pn && !p.note && <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{p.account?.name ?? "—"}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-medium text-slate-800 dark:text-neutral-200">
                        {formatMoney(p.amount, p.currency)}
                        {eq != null && <div className="text-xs font-normal text-slate-400">≈ {formatMoney(eq, base)}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-400 dark:text-neutral-600">
            Все расходные операции по этому контрагенту со статусом «факт», независимо от начислений — включая прямые выплаты с номинального/расчётного счёта. Суммы в валюте операции; «≈» — эквивалент в {base} по курсу.
          </p>
        </section>
      )}

      {/* Проекты в работе */}
      {(activeProjects ?? []).length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Проекты в работе
          </h2>
          <div className="surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                  <th className="px-5 py-3 font-medium">Проект</th>
                  <th className="px-5 py-3 font-medium">Идёт</th>
                  <th className="px-5 py-3 text-right font-medium">Срок</th>
                </tr>
              </thead>
              <tbody>
                {(activeProjects as { id: string; name: string; start_date: string; plan_work_days: number | null; due_date: string | null }[]).map((pr) => {
                  const eff = effectiveDue(pr.start_date, pr.plan_work_days, pr.due_date);
                  const elapsed = businessDaysBetween(pr.start_date, todayStr);
                  let srok: React.ReactNode = <span className="text-slate-400">не задан</span>;
                  if (eff) {
                    if (todayStr > eff) {
                      srok = <span className="font-medium text-red-600 dark:text-red-400">просрочка {workdaysLabel(businessDaysBetween(eff, todayStr))}</span>;
                    } else {
                      srok = <span className="text-slate-600 dark:text-neutral-300">до срока {workdaysLabel(businessDaysBetween(todayStr, eff))}</span>;
                    }
                  }
                  return (
                    <tr key={pr.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                      <td className="px-5 py-3 font-medium">
                        <Link href={`/projects/${pr.id}`} className="text-slate-800 hover:text-brand dark:text-neutral-200">{pr.name}</Link>
                      </td>
                      <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{workdaysLabel(elapsed)}</td>
                      <td className="px-5 py-3 text-right">{srok}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
            autoAccrue={emp.auto_accrue ?? false}
          />
        </div>
      )}

      {/* Реквизиты */}
      <section className="surface mb-6 p-6">
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
    </div>
  );
}
