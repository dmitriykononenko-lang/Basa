import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase, missingRates } from "@/lib/fx";
import RatesEditor from "@/components/RatesEditor";
import ExportButton from "@/components/ExportButton";

type Tx = {
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  note: string | null;
  category: { name: string } | null;
  counterparty: { name: string } | null;
  project: { name: string } | null;
  account: { name: string } | null;
};

const MONTHS_RU = [
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

function periodStart(period: string): string {
  const now = new Date();
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  if (period === "quarter")
    return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().slice(0, 10);
  return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
}

export default async function ReportsPage({
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
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Отчёты
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const base = team.base_currency;
  const supabase = await createClient();
  const start = periodStart(period);

  const [{ data: txs }, { data: fxRows }] = await Promise.all([
    supabase
      .from("transactions")
      .select(
        `type, amount, currency, occurred_on, note,
         account:accounts!transactions_account_id_fkey(name),
         category:categories(name),
         counterparty:counterparties(name),
         project:projects(name)`
      )
      .eq("team_id", team.id)
      .eq("status", "actual")
      .gte("occurred_on", start)
      .order("occurred_on", { ascending: false }),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  const rows = (txs ?? []) as unknown as Tx[];
  const rates = buildRateMap(fxRows ?? [], base);
  const usedCurrencies = [...new Set(rows.map((t) => t.currency))];
  const needRates = missingRates(usedCurrencies, rates, base);

  let income = 0;
  let expense = 0;
  const byMonth = new Map<string, { income: number; expense: number }>();
  const byCategory = new Map<string, number>();
  const byProject = new Map<string, number>();

  for (const t of rows) {
    if (t.type === "transfer") continue;
    const val = toBase(t.amount, t.currency, rates);
    const ym = t.occurred_on.slice(0, 7);
    const m = byMonth.get(ym) ?? { income: 0, expense: 0 };
    if (t.type === "income") {
      income += val;
      m.income += val;
      const pn = t.project?.name ?? "Без проекта";
      byProject.set(pn, (byProject.get(pn) ?? 0) + val);
    } else {
      expense += val;
      m.expense += val;
      const cn = t.category?.name ?? "Без категории";
      byCategory.set(cn, (byCategory.get(cn) ?? 0) + val);
      const pn = t.project?.name ?? "Без проекта";
      byProject.set(pn, (byProject.get(pn) ?? 0) - val);
    }
    byMonth.set(ym, m);
  }

  const months = [...byMonth.keys()].sort();
  const monthMax = Math.max(
    1,
    ...months.map((m) => Math.max(byMonth.get(m)!.income, byMonth.get(m)!.expense))
  );
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const catMax = Math.max(1, ...categories.map(([, v]) => v));
  const projects = [...byProject.entries()].sort((a, b) => b[1] - a[1]);

  const exportRows = rows.map((t) => [
    t.occurred_on,
    t.type === "income" ? "Доход" : t.type === "expense" ? "Расход" : "Перевод",
    t.category?.name ?? "",
    t.counterparty?.name ?? "",
    t.project?.name ?? "",
    t.account?.name ?? "",
    (t.amount / 100).toFixed(2).replace(".", ","),
    t.currency,
    t.note ?? "",
  ]);

  const PERIODS: [string, string][] = [
    ["month", "Месяц"],
    ["quarter", "Квартал"],
    ["year", "Год"],
  ];

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Отчёты
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Сводки в основной валюте ({base})
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportButton
            headers={[
              "Дата", "Тип", "Категория", "Контрагент", "Проект", "Счёт", "Сумма", "Валюта", "Комментарий",
            ]}
            rows={exportRows}
            filename={`basa-finance-${period}.csv`}
          />
        </div>
      </header>

      <div className="mb-6 inline-flex gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
        {PERIODS.map(([val, label]) => (
          <Link
            key={val}
            href={`/reports?period=${val}`}
            className={`rounded-full px-4 py-1.5 font-medium transition ${
              period === val
                ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white"
                : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {needRates.length > 0 && (
        <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          Нет курса для: {needRates.join(", ")}. Суммы в этих валютах учтены как
          1:1. Задайте курсы ниже для точного пересчёта.
        </p>
      )}

      {/* KPI */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi title="Доходы" value={formatMoney(income, base)} accent="emerald" />
        <Kpi title="Расходы" value={formatMoney(expense, base)} accent="red" />
        <Kpi title="Прибыль" value={formatMoney(income - expense, base)} accent="brand" />
      </div>

      {/* График по месяцам */}
      <section className="mt-6 rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          Доходы и расходы по месяцам
        </h2>
        {months.length > 0 ? (
          <div className="flex items-end gap-4 overflow-x-auto pb-2" style={{ minHeight: 180 }}>
            {months.map((m) => {
              const d = byMonth.get(m)!;
              const [y, mo] = m.split("-");
              return (
                <div key={m} className="flex shrink-0 flex-col items-center gap-2">
                  <div className="flex h-40 items-end gap-1">
                    <div
                      className="w-5 rounded-t bg-emerald-500"
                      style={{ height: `${(d.income / monthMax) * 100}%` }}
                      title={formatMoney(d.income, base)}
                    />
                    <div
                      className="w-5 rounded-t bg-red-500"
                      style={{ height: `${(d.expense / monthMax) * 100}%` }}
                      title={formatMoney(d.expense, base)}
                    />
                  </div>
                  <div className="text-xs text-slate-400 dark:text-neutral-500">
                    {MONTHS_RU[parseInt(mo) - 1]} {y.slice(2)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Нет операций за период.</p>
        )}
        <div className="mt-3 flex gap-4 text-xs text-slate-500 dark:text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-emerald-500" /> Доходы
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-red-500" /> Расходы
          </span>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Категории расходов */}
        <section className="rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Расходы по категориям
          </h2>
          {categories.length > 0 ? (
            <div className="space-y-3">
              {categories.map(([name, val]) => (
                <div key={name}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-slate-700 dark:text-neutral-300">{name}</span>
                    <span className="font-medium text-slate-800 dark:text-neutral-200">
                      {formatMoney(val, base)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-neutral-800">
                    <div
                      className="h-2 rounded-full bg-brand"
                      style={{ width: `${(val / catMax) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Нет расходов за период.</p>
          )}
        </section>

        {/* Проекты */}
        <section className="rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Прибыль по проектам
          </h2>
          {projects.length > 0 ? (
            <div className="space-y-2">
              {projects.map(([name, val]) => (
                <div key={name} className="flex justify-between text-sm">
                  <span className="text-slate-700 dark:text-neutral-300">{name}</span>
                  <span
                    className={`font-semibold ${
                      val < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {(val < 0 ? "−" : "+") + formatMoney(Math.abs(val), base)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Нет данных по проектам.</p>
          )}
        </section>
      </div>

      {/* Курсы валют */}
      {canEditFinance(role) && usedCurrencies.some((c) => c !== base) && (
        <section className="mt-6">
          <RatesEditor
            teamId={team.id}
            baseCurrency={base}
            currencies={usedCurrencies.filter((c) => c !== base)}
            rates={rates}
          />
        </section>
      )}
    </div>
  );
}

function Kpi({
  title,
  value,
  accent,
}: {
  title: string;
  value: string;
  accent: "emerald" | "red" | "brand";
}) {
  const map = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    brand: "text-brand",
  };
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-2 text-2xl font-bold ${map[accent]}`}>{value}</div>
    </div>
  );
}
