import Link from "next/link";
import { Manrope } from "next/font/google";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney, formatDate, todayInTz } from "@/lib/format";
import { buildRateMap, toBaseStrict, missingRates, latestRates } from "@/lib/fx";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/constants";
import AddAccrualForm from "@/components/AddAccrualForm";
import SalaryEditor from "@/components/SalaryEditor";
import CopyField from "@/components/CopyField";
import EditEmployeePayment from "@/components/EditEmployeePayment";
import EmployeeSummary from "@/components/employee/EmployeeSummary";
import EmployeeProductCard from "@/components/employee/EmployeeProductCard";
import AccrualsTable, { type AccrualRow } from "@/components/employee/AccrualsTable";
import { effectiveDue, businessDaysBetween, workdaysLabel } from "@/lib/workdays";
import { levelColor, levelName, DEFAULT_BAND } from "@/lib/assess";

// Правило владельца: какая фактическая расходная строка по сотруднику — «выплата сотруднику».
// Выплата, если выполнено ХОТЯ БЫ ОДНО:
//   (а) операция привязана (obligation_payments) к начислениям ЭТОГО сотрудника — любая статья;
//   (б) статья строки «зарплатная»: используется хотя бы в одном начислении команды
//       (obligations.category_id) ИЛИ её родительская статья называется «ФОТ».
// Остальное (без статьи, сервисы, лицензии, вывод собственнику…) — «прочие расходы»:
// в «Выплачено деньгами» и в сверку не входят.
type PayoutRule = { linkedTxIds: Set<string>; salaryCategoryIds: Set<string> };
function isEmployeePayout(line: { transaction_id: string; category_id: string | null }, rule: PayoutRule): boolean {
  if (rule.linkedTxIds.has(line.transaction_id)) return true;
  return line.category_id !== null && rule.salaryCategoryIds.has(line.category_id);
}
const PAYROLL_PARENT_NAME = "фот";

const RATE_STALE_DAYS = 30;

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
    .select("id, name, kind, employment_type, start_date, end_date, department, auto_accrue, advance_amount, payout_currency, payment_method, legal_status, payee_name, inn, bank_account, bank_name, bik, wallet_address, wallet_network, product_text, functions_text")
    .eq("id", id)
    .eq("team_id", team.id)
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
  // Оценки этого сотрудника (модуль «Оценка»)
  const { data: assessRows } = await supabase
    .from("assessments")
    .select("id, status, created_at, completed_at")
    .eq("team_id", team.id)
    .eq("counterparty_id", id)
    .order("created_at", { ascending: false });
  const assessList = (assessRows ?? []) as { id: string; status: string; created_at: string; completed_at: string | null }[];
  const { data: assessScoreRows } = assessList.length
    ? await supabase.from("assessment_scores").select("assessment_id, score").in("assessment_id", assessList.map((a) => a.id))
    : { data: [] as { assessment_id: string; score: number }[] };
  const assessAgg = new Map<string, { sum: number; n: number }>();
  for (const s of (assessScoreRows ?? []) as { assessment_id: string; score: number }[]) {
    const acc = assessAgg.get(s.assessment_id) ?? { sum: 0, n: 0 };
    acc.sum += Number(s.score); acc.n += 1; assessAgg.set(s.assessment_id, acc);
  }
  const assessments = assessList.map((a) => {
    const acc = assessAgg.get(a.id);
    return { ...a, overall: acc && acc.n ? Math.round(acc.sum / acc.n) : null };
  });
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
  // Названия статей начислений (в т.ч. архивных) — для «прочих» начислений без pay_part
  const oblCatIds = [...new Set([...oblCatId.values()].filter(Boolean) as string[])];
  const { data: oblCatRows } = oblCatIds.length
    ? await supabase.from("categories").select("id, name").eq("team_id", team.id).in("id", oblCatIds)
    : { data: [] as { id: string; name: string }[] };
  const catNameById = new Map(((oblCatRows ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  // «Уже запланировано» — только по начислениям ЭТОГО сотрудника (пачками, чтобы не упереться в длину URL)
  const empOblIds = ((bals ?? []) as { id: string }[]).map((b) => b.id);
  const scheduledOblIds = new Set<string>();
  for (let i = 0; i < empOblIds.length; i += 150) {
    const { data: scheduledRows } = await supabase
      .from("transactions").select("obligation_id")
      .eq("team_id", team.id).eq("status", "planned")
      .in("obligation_id", empOblIds.slice(i, i + 150));
    for (const r of (scheduledRows ?? []) as { obligation_id: string | null }[]) {
      if (r.obligation_id) scheduledOblIds.add(r.obligation_id);
    }
  }
  // Фактические выплаты — MANAGEMENT LAYER: берём строки аналитики, а не сами
  // операции. Если операция разнесена на части, сотруднику принадлежит ЕГО часть,
  // а не вся операция целиком (SPLIT-01). Начисления при этом живут отдельно
  // (obligation_balances выше) — разнесение фактической оплаты не создаёт
  // второго начисления, это разные экономические события.
  // Полная выборка постранично (PostgREST отдаёт ≤1000 строк за запрос), новые сверху.
  type PayoutLine = {
    transaction_id: string; split_id: string | null; occurred_on: string; amount: number; currency: string;
    category_id: string | null; project_id: string | null; note: string | null; account_id: string | null; is_split: boolean;
  };
  let payoutsFailed = false;
  const payoutLines = await fetchAllRows<PayoutLine>(async (from, to) => {
    const res = await supabase
      .from("transaction_lines")
      .select("transaction_id, split_id, occurred_on, amount, currency, category_id, project_id, note, account_id, is_split")
      .eq("team_id", team.id)
      .eq("counterparty_id", id)
      .eq("type", "expense")
      .eq("status", "actual")
      .order("occurred_on", { ascending: false })
      .order("transaction_id", { ascending: true })
      .order("split_id", { ascending: true, nullsFirst: true })
      .range(from, to);
    if (res.error) payoutsFailed = true;
    return { data: (res.data ?? null) as PayoutLine[] | null, error: res.error };
  });
  // Данные для правила «выплата сотруднику» — считаются запросом, без зашитых id.
  // (а) операции, привязанные к начислениям этого сотрудника
  const oblIdsForLinks = ((oblMetaRows ?? []) as { id: string }[]).map((o) => o.id);
  const linkedTxIds = new Set<string>();
  for (let i = 0; i < oblIdsForLinks.length; i += 150) {
    const { data: links, error } = await supabase
      .from("obligation_payments").select("transaction_id")
      .in("obligation_id", oblIdsForLinks.slice(i, i + 150))
      .not("transaction_id", "is", null);
    if (error) payoutsFailed = true;
    for (const l of (links ?? []) as { transaction_id: string | null }[]) if (l.transaction_id) linkedTxIds.add(l.transaction_id);
  }
  // (б) зарплатные статьи: используются в начислениях команды или вложены в «ФОТ»
  let ruleFailed = false;
  const teamOblCats = await fetchAllRows<{ category_id: string | null }>(async (from, to) => {
    const res = await supabase.from("obligations").select("category_id")
      .eq("team_id", team.id).not("category_id", "is", null)
      .order("id", { ascending: true }).range(from, to);
    if (res.error) ruleFailed = true;
    return { data: (res.data ?? null) as { category_id: string | null }[] | null, error: res.error };
  });
  const teamCats = await fetchAllRows<{ id: string; name: string; parent_id: string | null }>(async (from, to) => {
    const res = await supabase.from("categories").select("id, name, parent_id")
      .eq("team_id", team.id).order("id", { ascending: true }).range(from, to);
    if (res.error) ruleFailed = true;
    return { data: (res.data ?? null) as { id: string; name: string; parent_id: string | null }[] | null, error: res.error };
  });
  if (ruleFailed) payoutsFailed = true;
  const payrollParentIds = new Set(teamCats.filter((c) => c.name.trim().toLowerCase() === PAYROLL_PARENT_NAME).map((c) => c.id));
  const salaryCategoryIds = new Set<string>([
    ...(teamOblCats.map((o) => o.category_id).filter(Boolean) as string[]),
    ...teamCats.filter((c) => c.parent_id && payrollParentIds.has(c.parent_id)).map((c) => c.id),
  ]);
  const payoutRule: PayoutRule = { linkedTxIds, salaryCategoryIds };
  const teamCatName = new Map(teamCats.map((c) => [c.id, c.name]));
  const payouts = payoutLines.filter((l) => isEmployeePayout(l, payoutRule));
  const otherExpenses = payoutLines.filter((l) => !isEmployeePayout(l, payoutRule));
  const salaryRows = (salaries ?? []) as { id: string; effective_from: string; amount: number; currency: string }[];
  const positionRows = (positions ?? []) as { id: string; effective_from: string; position: string }[];
  const todayStr = todayInTz("Europe/Moscow");
  const currentPosition = positionRows.find((p) => p.effective_from <= todayStr)?.position ?? null;

  // Реальные курсы валют (USDT→RUB и т.п.) — иначе мультивалютные суммы считались 1:1
  const rates = buildRateMap(fxRows ?? [], base);
  const projName = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const rows = ((bals ?? []) as unknown as Bal[]).slice().sort((a, b) =>
    ((a.period_month ?? a.due_date ?? "") as string).localeCompare((b.period_month ?? b.due_date ?? "") as string)
  );

  // Валюты без курса НЕ пересчитываем 1:1 и не смешиваем с базовой валютой:
  // такие суммы исключаются из итогов в базовой валюте и выводятся предупреждением.
  const noRate = missingRates(
    [...rows.map((o) => o.currency), ...payoutLines.map((p) => p.currency)],
    rates,
    base,
  );
  const unconvAccrued = new Map<string, number>();
  const unconvOut = new Map<string, number>();
  const unconvPaidActual = new Map<string, number>();
  const addTo = (m: Map<string, number>, cur: string, v: number) => m.set(cur, (m.get(cur) ?? 0) + v);

  let totalAccrued = 0, totalPaid = 0, totalOut = 0;
  const fix = { acc: 0, paid: 0 };
  const variable = { acc: 0, paid: 0 };
  const other = { acc: 0, paid: 0 }; // pay_part не задан — не оклад и не бонус
  const monthMap = new Map<string, { accrued: number; paid: number }>();
  const byProject = new Map<string, { name: string; val: number }>();
  const otherCats = new Map<string, number>(); // названия статей «прочих» начислений → сумма
  for (const o of rows) {
    const a = toBaseStrict(o.amount, o.currency, rates);
    const p = toBaseStrict(o.paid, o.currency, rates);
    const out = toBaseStrict(o.outstanding, o.currency, rates);
    if (a === null || p === null || out === null) {
      addTo(unconvAccrued, o.currency, o.amount);
      addTo(unconvOut, o.currency, o.outstanding);
      continue;
    }
    totalAccrued += a;
    totalPaid += p;
    totalOut += out;
    const ym = (o.period_month ?? o.due_date ?? "—").slice(0, 7);
    const mm = monthMap.get(ym) ?? { accrued: 0, paid: 0 };
    mm.accrued += a; mm.paid += p; monthMap.set(ym, mm);
    // Свод по проектам — все начисления с проектом (бонусы, комиссии и т.п.), не только pay_part='variable'
    if (o.project_id) {
      const cur = byProject.get(o.project_id) ?? { name: projName.get(o.project_id) ?? "Проект", val: 0 };
      cur.val += a;
      byProject.set(o.project_id, cur);
    }
    if (o.pay_part === "variable") {
      variable.acc += a; variable.paid += p;
    } else if (o.pay_part === "fixed") {
      fix.acc += a; fix.paid += p;
    } else {
      other.acc += a; other.paid += p;
      const cid = oblCatId.get(o.id);
      const cn = (cid && catNameById.get(cid)) || "прочее";
      otherCats.set(cn, (otherCats.get(cn) ?? 0) + a);
    }
  }
  const monthly = [...monthMap.entries()]
    .filter(([k]) => k !== "—")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, v]) => ({ ym, accrued: v.accrued, paid: v.paid }));
  const initials = String(emp.name).split(/\s+/).filter(Boolean).slice(0, 2).map((s: string) => s[0]).join("").toUpperCase() || "?";

  const accNameById = new Map(((accounts ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const payoutRows = payouts.map((p) => ({
    key: p.split_id ?? p.transaction_id,
    occurred_on: p.occurred_on,
    amount: p.amount,
    currency: p.currency,
    project_id: p.project_id,
    note: p.note,
    isSplit: p.is_split,
    account: p.account_id ? { name: accNameById.get(p.account_id) ?? "—" } : null,
  }));
  let totalPaidActual = 0;
  const paidByCur = new Map<string, number>();
  for (const p of payoutRows) {
    const v = toBaseStrict(p.amount, p.currency, rates);
    if (v === null) addTo(unconvPaidActual, p.currency, p.amount);
    else totalPaidActual += v;
    paidByCur.set(p.currency, (paidByCur.get(p.currency) ?? 0) + p.amount);
  }
  const curChips = [...paidByCur.entries()];
  // Прочие расходы на этого контрагента — не выплата сотруднику (правило isEmployeePayout)
  const otherExpenseRows = otherExpenses.map((p) => ({
    key: p.split_id ?? p.transaction_id,
    occurred_on: p.occurred_on,
    amount: p.amount,
    currency: p.currency,
    category: p.category_id ? teamCatName.get(p.category_id) ?? "—" : "Без статьи",
    note: p.note,
    isSplit: p.is_split,
    account: p.account_id ? accNameById.get(p.account_id) ?? "—" : "—",
  }));
  let totalOtherExp = 0;
  const unconvOtherExp = new Map<string, number>();
  const otherExpByCur = new Map<string, number>();
  for (const p of otherExpenseRows) {
    const v = toBaseStrict(p.amount, p.currency, rates);
    if (v === null) addTo(unconvOtherExp, p.currency, p.amount);
    else totalOtherExp += v;
    addTo(otherExpByCur, p.currency, p.amount);
  }
  const unconvLabel = (m: Map<string, number>) => [...m.entries()].map(([c, v]) => formatMoney(v, c)).join(", ");

  // Подпись доли «прочих» в структуре: название статьи, если она одна (обычно «Агентская комиссия»)
  const otherLabel = otherCats.size === 1 ? [...otherCats.keys()][0].toLowerCase() : "комиссии и прочее";
  // Суммы в исходных валютах (без пересчёта) — рядом с итогами в базовой валюте
  const byCur = (pick: (o: Bal) => number) => {
    const m = new Map<string, number>();
    for (const o of rows) m.set(o.currency, (m.get(o.currency) ?? 0) + pick(o));
    return [...m.entries()];
  };
  const accruedByCur = byCur((o) => o.amount);
  const outByCur = byCur((o) => o.outstanding).filter(([, v]) => v !== 0);
  // Курсы, по которым пересчитаны валюты карточки, — с датой и признаком «устарел»
  const rateInfo = latestRates(fxRows ?? []);
  const usedForeign = [...new Set([...rows.map((o) => o.currency), ...payoutLines.map((p) => p.currency)])]
    .filter((c) => c !== base && rateInfo[c]);
  const ageDays = (d: string) => Math.floor((Date.parse(todayStr) - Date.parse(d)) / 86_400_000);
  const ratesUsed = usedForeign.map((c) => ({ cur: c, rate: rateInfo[c].rate, date: rateInfo[c].date, stale: ageDays(rateInfo[c].date) > RATE_STALE_DAYS }));
  const anyStale = ratesUsed.some((r) => r.stale);

  const projectRows = [...byProject.entries()]
    .map(([pid, x]) => ({ pid, name: x.name, val: x.val }))
    .sort((a, b) => b.val - a.val);
  const manage = canEditFinance(role);

  // сверка «закрыто начислений» vs «выплачено деньгами» (только пересчитанные суммы)
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
    category_name: (() => { const c = oblCatId.get(o.id); return c ? catNameById.get(c) ?? null : null; })(),
    alreadyScheduled: scheduledOblIds.has(o.id),
  }));

  return (
    <div className={`${manrope.className} p-4 sm:p-8`}>
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

      {/* Нет курса валюты — суммы в ней не пересчитаны и в итоги в базовой валюте не входят */}
      {noRate.length > 0 && (
        <div role="alert" className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200/70 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40">
          <b className="font-semibold">Нет курса для {noRate.join(", ")}</b> — суммы в {noRate.length > 1 ? "этих валютах" : "этой валюте"} не пересчитаны в {base} и не входят в итоги ниже.
          {unconvAccrued.size > 0 && <> Начислено: {unconvLabel(unconvAccrued)}; остаток: {unconvLabel(unconvOut)}.</>}
          {unconvPaidActual.size > 0 && <> Выплачено деньгами: {unconvLabel(unconvPaidActual)}.</>}
          {" "}Задайте курс в <Link href="/reports" className="font-medium underline underline-offset-2">отчётах</Link>.
        </div>
      )}
      {ratesUsed.length > 0 && (
        <p className={`mb-4 rounded-2xl px-4 py-2.5 text-sm ring-1 ${anyStale
          ? "bg-amber-50 text-amber-800 ring-amber-200/70 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40"
          : "bg-slate-50 text-slate-600 ring-slate-200/70 dark:bg-white/[0.03] dark:text-neutral-400 dark:ring-white/[0.07]"}`}>
          Итоги в {base} — пересчёт по курсу:{" "}
          {ratesUsed.map((r, i) => (
            <span key={r.cur}>
              {i > 0 && "; "}
              {r.cur} = {r.rate.toLocaleString("ru-RU")} {base} от {formatDate(r.date)}
              {r.stale && <b className="font-semibold"> (курсу больше {RATE_STALE_DAYS} дней)</b>}
            </span>
          ))}
          . Суммы в исходной валюте — в плитках и таблицах.
          {anyStale && <> Обновите курс в <Link href="/reports" className="font-medium underline underline-offset-2">отчётах</Link>, иначе пересчёт неточен.</>}
        </p>
      )}
      {payoutsFailed && (
        <div role="alert" className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200/70 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/40">
          Не удалось загрузить выплаты или данные для их отбора полностью — «Выплачено деньгами» и «Прочие расходы» могут быть неточны. Обновите страницу.
        </div>
      )}

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
          other={other}
          otherLabel={otherLabel}
          monthly={monthly}
          hasPayouts={payoutRows.length > 0}
          accruedByCur={accruedByCur}
          outByCur={outByCur}
        />
      </div>

      {/* Карточка должности: продукт (ЦКП) + функции-теги */}
      <EmployeeProductCard employeeId={emp.id} product={emp.product_text ?? null} functions={emp.functions_text ?? null} canManage={manage} />

      {/* Отдел, должность и оклад — подняли выше */}
      {manage && user && (
        <div className="mb-4">
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
            advanceAmount={emp.advance_amount ?? 0}
          />
        </div>
      )}

      {/* Сверка — только если расходится */}
      {payoutRows.length > 0 && !reconciled && !payoutsFailed && (
        <div className="mb-6 rounded-2xl bg-amber-50/60 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40">
          Расхождение {formatMoney(Math.abs(diff), base)}: закрыто начислений {formatMoney(totalPaid, base)}, выплачено деньгами {formatMoney(totalPaidActual, base)}. Обычно это погашения без операции или непривязанные выплаты.
        </div>
      )}

      {/* Начисления (к выплате) — главная рабочая таблица */}
      {accrualRows.length > 0 ? (
        <AccrualsTable
          id="accruals"
          rows={accrualRows}
          base={base}
          rates={rates}
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
        <p id="accruals" className="mb-6 rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Нет начислений. Нажмите «Начислить».
        </p>
      )}

      {/* Фактические выплаты (операции) */}
      {payoutRows.length === 0 && !payoutsFailed && (
        <p id="payouts" className="mb-6 rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Выплат деньгами пока нет: нет операций «факт», привязанных к начислениям сотрудника или проведённых по зарплатной статье.
        </p>
      )}
      {payoutRows.length > 0 && (
        <section id="payouts" className="mb-6 scroll-mt-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
              Выплачено деньгами · операции ({payoutRows.length})
            </h2>
            <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">
              Всего: {formatMoney(totalPaidActual, base)}
              {unconvPaidActual.size > 0 && <span className="font-normal text-amber-700 dark:text-amber-400"> + {unconvLabel(unconvPaidActual)} без курса</span>}
            </span>
          </div>
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
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
                  const eq = p.currency === base ? null : toBaseStrict(p.amount, p.currency, rates);
                  return (
                    <tr key={p.key} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
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
                        {p.isSplit && <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-white/[0.06] dark:text-neutral-400">часть операции</span>}
                      </td>
                      <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{p.account?.name ?? "—"}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-medium text-slate-800 dark:text-neutral-200">
                        {formatMoney(p.amount, p.currency)}
                        {p.currency !== base && (eq != null
                          ? <div className="text-xs font-normal text-slate-400">≈ {formatMoney(eq, base)}</div>
                          : <div className="text-xs font-normal text-amber-700 dark:text-amber-400">нет курса</div>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-400 dark:text-neutral-600">
            Расходные операции «факт» по этому сотруднику, от новых к старым, которые считаются выплатой: привязаны к его начислениям или проведены по зарплатной статье (используется в начислениях или входит в «ФОТ»). Остальное — в блоке «Прочие расходы» ниже. Если операция разнесена на части, показана только часть, отнесённая сотруднику. Суммы в валюте операции; «≈» — эквивалент в {base} по последнему курсу.
          </p>
        </section>
      )}

      {/* Прочие расходы на этого контрагента — не выплата сотруднику, в итоги и сверку не входят */}
      {otherExpenseRows.length > 0 && (
        <details id="other-expenses" className="group mb-6 scroll-mt-4">
          <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
              <span className="mr-1 inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden>›</span>
              Прочие расходы на этого контрагента ({otherExpenseRows.length})
            </h2>
            <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">
              {formatMoney(totalOtherExp, base)}
              {unconvOtherExp.size > 0 && <span className="font-normal text-amber-700 dark:text-amber-400"> + {unconvLabel(unconvOtherExp)} без курса</span>}
            </span>
          </summary>
          {[...otherExpByCur.keys()].some((c) => c !== base) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[...otherExpByCur.entries()].map(([cur, sum]) => (
                <span key={cur} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-600 dark:bg-white/[0.06] dark:text-neutral-300">{formatMoney(sum, cur)}</span>
              ))}
            </div>
          )}
          <div className="surface mt-3 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                  <th className="px-5 py-3 font-medium">Дата</th>
                  <th className="px-5 py-3 font-medium">Статья · описание</th>
                  <th className="px-5 py-3 font-medium">Счёт</th>
                  <th className="px-5 py-3 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {otherExpenseRows.map((p) => {
                  const eq = p.currency === base ? null : toBaseStrict(p.amount, p.currency, rates);
                  return (
                    <tr key={p.key} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600 dark:text-neutral-400">{formatDate(p.occurred_on)}</td>
                      <td className="px-5 py-3 text-slate-700 dark:text-neutral-300">
                        <span className="font-medium text-slate-800 dark:text-neutral-200">{p.category}</span>
                        {p.note && <span className="ml-2 text-xs text-slate-400">{p.note}</span>}
                        {p.isSplit && <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-white/[0.06] dark:text-neutral-400">часть операции</span>}
                      </td>
                      <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">{p.account}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-medium text-slate-800 dark:text-neutral-200">
                        {formatMoney(p.amount, p.currency)}
                        {p.currency !== base && (eq != null
                          ? <div className="text-xs font-normal text-slate-400">≈ {formatMoney(eq, base)}</div>
                          : <div className="text-xs font-normal text-amber-700 dark:text-amber-400">нет курса</div>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-400 dark:text-neutral-600">
            Расходы по этому контрагенту, которые не считаются выплатой сотруднику: операция не привязана к его начислениям и статья не зарплатная (не используется в начислениях и не входит в «ФОТ»). В «Выплачено деньгами» и сверку не входят.
          </p>
        </details>
      )}

      {/* Проекты в работе */}
      {(activeProjects ?? []).length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Проекты в работе
          </h2>
          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
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
          </div>
        </section>
      )}

      {/* Оценка персонала */}
      {assessments.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Оценка Soft Skills
          </h2>
          <div className="surface overflow-hidden divide-y divide-slate-100 dark:divide-white/[0.05]">
            {assessments.map((a) => {
              const done = a.status === "done" && a.overall != null;
              const col = a.overall != null ? levelColor(a.overall, DEFAULT_BAND) : "#8b8f84";
              const inner = (
                <div className="flex items-center gap-4 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800 dark:text-neutral-200">
                      {done ? "Оценка пройдена" : "Тест отправлен · ожидает прохождения"}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400 dark:text-neutral-500">
                      {formatDate(a.completed_at ?? a.created_at)}
                    </div>
                  </div>
                  {done ? (
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-xl font-semibold leading-none" style={{ color: col }}>{a.overall}</div>
                      <div className="mt-0.5 text-[11px] font-medium" style={{ color: col }}>{levelName(a.overall!, DEFAULT_BAND)}</div>
                    </div>
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      Ожидает
                    </span>
                  )}
                </div>
              );
              return done ? (
                <Link key={a.id} href={`/assess/${a.id}`} className="block transition hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                  {inner}
                </Link>
              ) : (
                <div key={a.id}>{inner}</div>
              );
            })}
          </div>
        </section>
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
