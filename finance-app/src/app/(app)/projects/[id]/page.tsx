import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance, canViewFinance } from "@/lib/team";
import { formatMoney, formatDate } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import EditProjectForm from "@/components/EditProjectForm";
import DeleteProjectButton from "@/components/DeleteProjectButton";
import { effectiveDue, businessDaysBetween, workdaysLabel } from "@/lib/workdays";

export default async function ProjectPage({
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

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, status, responsible_counterparty_id, manager_counterparty_id, start_date, plan_work_days, due_date, completed_on, bonus_amount, bonus_currency")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const [{ data: employees }, { data: tiers }] = await Promise.all([
    supabase
      .from("counterparties")
      .select("id, name")
      .eq("team_id", team.id)
      .contains("kinds", ["employee"])
      .eq("archived", false)
      .order("name"),
    supabase
      .from("project_bonus_tiers")
      .select("max_overrun_wd, percent")
      .eq("team_id", team.id)
      .order("max_overrun_wd", { ascending: true }),
  ]);
  const responsibleName =
    (employees ?? []).find((e) => e.id === project.responsible_counterparty_id)?.name ?? null;
  const managerName =
    (employees ?? []).find((e) => e.id === project.manager_counterparty_id)?.name ?? null;
  const manage = canEditFinance(role);
  const showFinance = canViewFinance(role);

  const [{ data: obls }, { data: fxRows }] = await Promise.all([
    supabase
      .from("obligation_balances")
      .select("type, amount, outstanding, currency, pay_part, counterparty:counterparties(name)")
      .eq("team_id", team.id)
      .eq("project_id", id),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  // Транзакции проекта (выручка/затраты/операции) выбираем только для финансовых ролей —
  // аналитику (employee) эти суммы не уходят в браузер.
  const { data: txs } = showFinance
    ? await supabase
        .from("transactions")
        .select("id, type, amount, currency, occurred_on, category:categories(name), counterparty:counterparties(name)")
        .eq("team_id", team.id)
        .eq("project_id", id)
        .eq("status", "actual")
        .order("occurred_on", { ascending: false })
        .limit(100)
    : { data: [] as unknown[] };

  const rates = buildRateMap(fxRows ?? [], base);
  const rows = (txs ?? []) as unknown as {
    id: string;
    type: "income" | "expense" | "transfer";
    amount: number;
    currency: string;
    occurred_on: string;
    category: { name: string } | null;
    counterparty: { name: string } | null;
  }[];

  let revenue = 0;
  let costs = 0;
  const costByCat = new Map<string, number>();
  for (const t of rows) {
    const v = toBase(t.amount, t.currency, rates);
    if (t.type === "income") revenue += v;
    else if (t.type === "expense") {
      costs += v;
      const c = t.category?.name ?? "Без статьи";
      costByCat.set(c, (costByCat.get(c) ?? 0) + v);
    }
  }
  const profit = revenue - costs;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  // Долги и оплата труда по проекту (из обязательств)
  let receivable = 0;
  let payable = 0;
  let laborAccrued = 0;
  const laborByEmployee = new Map<string, number>();
  for (const o of (obls ?? []) as unknown as {
    type: "receivable" | "payable";
    amount: number;
    outstanding: number;
    currency: string;
    pay_part: string | null;
    counterparty: { name: string } | null;
  }[]) {
    if (o.outstanding > 0) {
      const ov = toBase(o.outstanding, o.currency, rates);
      if (o.type === "receivable") receivable += ov;
      else payable += ov;
    }
    if (o.type === "payable" && o.pay_part) {
      const v = toBase(o.amount, o.currency, rates);
      laborAccrued += v;
      const en = o.counterparty?.name ?? "Сотрудник";
      laborByEmployee.set(en, (laborByEmployee.get(en) ?? 0) + v);
    }
  }
  const laborRows = [...laborByEmployee.entries()].sort((a, b) => b[1] - a[1]);

  const costs2 = [...costByCat.entries()].sort((a, b) => b[1] - a[1]);
  const costMax = Math.max(1, ...costs2.map(([, v]) => v));

  // Сроки и бонус
  const today = new Date().toISOString().slice(0, 10);
  const isDone = project.status === "done";
  const effDue = effectiveDue(project.start_date, project.plan_work_days, project.due_date);
  const refDate = isDone && project.completed_on ? project.completed_on : today;
  const elapsedWd = businessDaysBetween(project.start_date, refDate);
  let overrunWd = 0;
  let remainingWd: number | null = null;
  if (effDue) {
    if (refDate > effDue) overrunWd = businessDaysBetween(effDue, refDate);
    else remainingWd = businessDaysBetween(refDate, effDue);
  }
  const pickPct = (overrun: number): number => {
    for (const t of (tiers ?? []) as { max_overrun_wd: number; percent: number }[]) {
      if (t.max_overrun_wd >= overrun) return Number(t.percent);
    }
    return 100;
  };
  const bonusPct = pickPct(overrunWd);
  const computedBonus = Math.round((project.bonus_amount * bonusPct) / 100);

  return (
    <div className="p-6 sm:p-8">
      <Link href="/projects" className="text-sm text-slate-400 hover:text-brand">
        ← Проекты
      </Link>
      <header className="mb-6 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            {project.name}
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            {showFinance ? "Финансы и маржинальность проекта" : "Сроки и мотивация по проекту"}
            {responsibleName && <> · аналитик: <b>{responsibleName}</b></>}
            {managerName && <> · менеджер: <b>{managerName}</b></>}
          </p>
        </div>
        {manage && (
          <EditProjectForm
            projectId={project.id}
            name={project.name}
            status={project.status}
            responsibleId={project.responsible_counterparty_id}
            managerId={project.manager_counterparty_id}
            employees={employees ?? []}
            startDate={project.start_date}
            planWorkDays={project.plan_work_days}
            dueDate={project.due_date}
            completedOn={project.completed_on}
            bonusAmount={project.bonus_amount}
            bonusCurrency={project.bonus_currency}
          />
        )}
      </header>

      {showFinance && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat title="Выручка" value={formatMoney(revenue, base)} accent="emerald" />
          <Stat title="Затраты" value={formatMoney(costs, base)} accent="red" />
          <Stat title="Прибыль" value={formatMoney(profit, base)} accent={profit < 0 ? "red" : "emerald"} />
          <Stat title="Маржинальность" value={`${margin.toFixed(1)}%`} accent={margin < 0 ? "red" : "brand"} />
        </div>
      )}

      {(receivable > 0 || payable > 0 || laborAccrued > 0) && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {laborAccrued > 0 && (
            <Stat title="Оплата труда (начислено)" value={formatMoney(laborAccrued, base)} accent="red" />
          )}
          {receivable > 0 && (
            <Stat title="Нам должны по проекту" value={formatMoney(receivable, base)} accent="emerald" />
          )}
          {payable > 0 && (
            <Stat title="Мы должны по проекту" value={formatMoney(payable, base)} accent="red" />
          )}
        </div>
      )}

      {/* Сроки и бонус аналитику */}
      <section className="mt-6 rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          Сроки и бонус
        </h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Старт" value={formatDate(project.start_date)} />
          <Field label="Срок сдачи" value={effDue ? formatDate(effDue) : "не задан"} />
          <Field label={isDone ? "Шло раб. дней" : "Идёт раб. дней"} value={workdaysLabel(elapsedWd)} />
          {isDone ? (
            <Field label="Сдан" value={project.completed_on ? formatDate(project.completed_on) : "—"} accent="emerald" />
          ) : effDue ? (
            overrunWd > 0 ? (
              <Field label="Просрочка" value={workdaysLabel(overrunWd)} accent="red" />
            ) : (
              <Field label="До срока" value={remainingWd != null ? workdaysLabel(remainingWd) : "—"} />
            )
          ) : (
            <Field label="Срок" value="не задан" />
          )}
          <Field label="Аналитик" value={responsibleName ?? "не назначен"} />
          <Field label="Менеджер" value={managerName ?? "не назначен"} />
          <Field label="Базовый бонус" value={project.bonus_amount > 0 ? formatMoney(project.bonus_amount, project.bonus_currency) : "—"} />
          {project.bonus_amount > 0 && (
            <Field
              label={isDone ? "Начислено за сдачу" : `Бонус при сдаче сейчас (${bonusPct}%)`}
              value={formatMoney(computedBonus, project.bonus_currency)}
              accent={isDone ? "emerald" : "brand"}
            />
          )}
          {project.bonus_amount > 0 && overrunWd > 0 && (
            <Field label="Коэффициент за просрочку" value={`${bonusPct}%`} accent="red" />
          )}
        </div>
        <p className="mt-3 text-[11px] text-slate-400 dark:text-neutral-600">
          Бонус начисляется ответственному автоматически при переводе проекта в «Сдан». Просрочка считается в рабочих
          днях и снижает бонус по ступеням мотивации (настраиваются в «Настройках»).
        </p>
      </section>

      {showFinance && (
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Структура затрат */}
        <section className="rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Затраты по статьям
          </h2>
          {costs2.length > 0 ? (
            <div className="space-y-3">
              {costs2.map(([name, val]) => (
                <div key={name}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-slate-700 dark:text-neutral-300">{name}</span>
                    <span className="font-medium text-slate-800 dark:text-neutral-200">{formatMoney(val, base)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-neutral-800">
                    <div className="h-2 rounded-full bg-red-500" style={{ width: `${(val / costMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Затрат по проекту нет.</p>
          )}

          {laborRows.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/[0.06]">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
                в т.ч. оплата труда
              </div>
              <ul className="space-y-1.5 text-sm">
                {laborRows.map(([n, v]) => (
                  <li key={n} className="flex justify-between">
                    <span className="text-slate-600 dark:text-neutral-400">{n}</span>
                    <span className="font-medium text-slate-700 dark:text-neutral-300">{formatMoney(v, base)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Операции */}
        <section className="rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <h2 className="border-b border-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
            Операции
          </h2>
          {rows.length > 0 ? (
            <table className="w-full text-sm">
              <tbody>
                {rows.slice(0, 30).map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-500 dark:text-neutral-400">{formatDate(t.occurred_on)}</td>
                    <td className="px-5 py-3 text-slate-700 dark:text-neutral-300">
                      {t.category?.name ?? "—"}
                      {t.counterparty?.name && <span className="ml-2 text-xs text-slate-400">· {t.counterparty.name}</span>}
                    </td>
                    <td className={`px-5 py-3 text-right font-semibold ${
                      t.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                    }`}>
                      {t.type === "income" ? "+" : "−"}{formatMoney(t.amount, t.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 py-4 text-sm text-slate-400">Операций нет.</p>
          )}
        </section>
      </div>
      )}
    </div>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: "emerald" | "red" | "brand" }) {
  const map = { emerald: "text-emerald-600 dark:text-emerald-400", red: "text-red-600 dark:text-red-400", brand: "text-brand" };
  return (
    <div>
      <div className="text-xs text-slate-400 dark:text-neutral-500">{label}</div>
      <div className={`mt-0.5 font-medium ${accent ? map[accent] : "text-slate-800 dark:text-neutral-200"}`}>{value}</div>
    </div>
  );
}

function Stat({ title, value, accent }: { title: string; value: string; accent: "emerald" | "red" | "brand" }) {
  const map = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    brand: "text-brand",
  };
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-2 text-xl font-bold ${map[accent]}`}>{value}</div>
    </div>
  );
}
