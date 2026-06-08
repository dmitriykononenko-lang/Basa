import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import AddObligationForm from "@/components/AddObligationForm";
import PayObligationButton from "@/components/PayObligationButton";
import PlanObligationButton from "@/components/PlanObligationButton";
import LinkPaymentButton from "@/components/LinkPaymentButton";

type Row = {
  id: string;
  type: "receivable" | "payable";
  amount: number;
  currency: string;
  outstanding: number;
  due_date: string | null;
  note: string | null;
  counterparty_id: string;
  project_id: string | null;
  counterparty: { name: string } | null;
  project: { name: string } | null;
};

export default async function DebtsPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string }>;
}) {
  const { by } = await searchParams;
  const groupBy = by === "projects" ? "projects" : "counterparties";

  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Долги
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const cur = team.base_currency;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: obligations }, { data: balances }, { data: counterparties }, { data: projects }, { data: fxRows }, { data: accounts }] =
    await Promise.all([
      supabase
        .from("obligation_balances")
        .select(
          `id, type, amount, currency, outstanding, due_date, note,
           counterparty_id, project_id,
           counterparty:counterparties(name), project:projects(name)`
        )
        .eq("team_id", team.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("account_balances")
        .select("balance, currency")
        .eq("team_id", team.id),
      supabase
        .from("counterparties")
        .select("id, name")
        .eq("team_id", team.id)
        .eq("archived", false)
        .order("name"),
      supabase
        .from("projects")
        .select("id, name")
        .eq("team_id", team.id)
        .eq("archived", false)
        .order("name"),
      supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
      supabase.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false).order("created_at"),
    ]);

  const { data: categories } = await supabase
    .from("categories").select("id, name, kind").eq("team_id", team.id).eq("archived", false).order("name");

  // Метаданные обязательств (вью obligation_balances их не содержит): статья «За что», категория/проект для планирования
  const { data: oblMetaRows } = await supabase
    .from("obligations")
    .select("id, category_id, project_id, category:categories(name)")
    .eq("team_id", team.id);
  type OblMeta = { id: string; category_id: string | null; project_id: string | null; category: { name: string } | null };
  const oblMeta = new Map(((oblMetaRows ?? []) as unknown as OblMeta[]).map((o) => [o.id, o]));
  const oblCatName = new Map([...oblMeta].map(([id, o]) => [id, o.category?.name ?? null]));

  // Обязательства, по которым уже есть запланированный платёж (чтобы не задваивать)
  const { data: scheduledRows } = await supabase
    .from("transactions")
    .select("obligation_id")
    .eq("team_id", team.id)
    .eq("status", "planned")
    .not("obligation_id", "is", null);
  const scheduledOblIds = new Set(
    ((scheduledRows ?? []) as { obligation_id: string | null }[]).map((r) => r.obligation_id).filter(Boolean) as string[]
  );

  const rows = (obligations ?? []) as unknown as Row[];
  const rates = buildRateMap(fxRows ?? [], cur);

  let receivable = 0;
  let payable = 0;
  for (const o of rows) {
    if (o.outstanding <= 0) continue;
    const val = toBase(o.outstanding, o.currency, rates);
    if (o.type === "receivable") receivable += val;
    else payable += val;
  }
  const obligationsBalance = receivable - payable;
  const moneyOnAccounts = (balances ?? []).reduce(
    (s, b) => s + toBase(b.balance, b.currency, rates),
    0
  );

  // Разбивка по контрагентам/проектам (нетто = дебиторка − кредиторка)
  const groups = new Map<string, { name: string; net: number }>();
  for (const o of rows) {
    if (o.outstanding <= 0) continue;
    const key =
      groupBy === "projects"
        ? o.project_id ?? "none"
        : o.counterparty_id;
    const name =
      groupBy === "projects"
        ? o.project?.name ?? "Без проекта"
        : o.counterparty?.name ?? "—";
    const valBase = toBase(o.outstanding, o.currency, rates);
    const signed = o.type === "receivable" ? valBase : -valBase;
    const g = groups.get(key) ?? { name, net: 0 };
    g.net += signed;
    groups.set(key, g);
  }
  const groupList = [...groups.values()].sort((a, b) => b.net - a.net);

  // Диаграмма «Обязательства и деньги»
  const chartMax = Math.max(moneyOnAccounts, receivable, payable, 1);
  const chart = [
    { label: "Денег на счетах", value: moneyOnAccounts, color: "bg-brand" },
    { label: "Дебиторка", value: receivable, color: "bg-emerald-500" },
    { label: "Кредиторка", value: payable, color: "bg-red-500" },
  ];

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Отчёт по задолженностям
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Дебиторская и кредиторская задолженность по контрагентам
          </p>
        </div>
      </header>

      {/* Баннер-итог */}
      <div
        className={`mb-6 rounded-3xl px-6 py-4 text-sm ring-1 ${
          obligationsBalance < 0
            ? "bg-red-50 text-red-700 ring-red-100 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/40"
            : "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/40"
        }`}
      >
        {obligationsBalance < 0 ? (
          <>
            На данный момент по сумме всех задолженностей{" "}
            <b>вы должны вашим контрагентам</b>{" "}
            {formatMoney(-obligationsBalance, cur)}
          </>
        ) : (
          <>
            На данный момент по сумме всех задолженностей{" "}
            <b>вам должны контрагенты</b> {formatMoney(obligationsBalance, cur)}
          </>
        )}
      </div>

      {/* Карточки */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card title="Дебиторская задолженность" value={formatMoney(receivable, cur)} accent="emerald" />
        <Card title="Кредиторская задолженность" value={"−" + formatMoney(payable, cur)} accent="red" />
        <Card
          title="Баланс по обязательствам"
          value={(obligationsBalance < 0 ? "−" : "") + formatMoney(Math.abs(obligationsBalance), cur)}
          accent={obligationsBalance < 0 ? "red" : "emerald"}
        />
      </div>

      {/* Диаграмма */}
      <section className="mt-6 rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
          Обязательства и деньги
        </h2>
        <div className="space-y-3">
          {chart.map((c) => (
            <div key={c.label} className="flex items-center gap-3">
              <div className="w-36 shrink-0 text-sm text-slate-500 dark:text-neutral-400">
                {c.label}
              </div>
              <div className="h-6 flex-1 rounded-lg bg-slate-100 dark:bg-neutral-800">
                <div
                  className={`h-6 rounded-lg ${c.color}`}
                  style={{ width: `${(c.value / chartMax) * 100}%` }}
                />
              </div>
              <div className="w-36 shrink-0 text-right text-sm font-medium text-slate-700 dark:text-neutral-300">
                {formatMoney(c.value, cur)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Переключатель + разбивка */}
      <section className="mt-6">
        <div className="mb-3 inline-flex gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          <Toggle href="/debts" active={groupBy === "counterparties"} label="Контрагенты" />
          <Toggle href="/debts?by=projects" active={groupBy === "projects"} label="Проекты" />
        </div>

        {groupList.length > 0 ? (
          <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                  <th className="px-5 py-3 font-medium">
                    {groupBy === "projects" ? "Проект" : "Контрагент"}
                  </th>
                  <th className="px-5 py-3 text-right font-medium">Сальдо</th>
                </tr>
              </thead>
              <tbody>
                {groupList.map((g, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                    <td className="px-5 py-3 font-medium text-slate-800 dark:text-neutral-200">
                      {g.name}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-semibold ${
                        g.net < 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {(g.net < 0 ? "−" : "+") + formatMoney(Math.abs(g.net), cur)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
            Открытых задолженностей нет.
          </p>
        )}
      </section>

      {/* Добавление долга */}
      {canEditFinance(role) && user && (
        <section className="mt-6">
          <AddObligationForm
            teamId={team.id}
            userId={user.id}
            baseCurrency={cur}
            counterparties={counterparties ?? []}
            projects={projects ?? []}
            categories={(categories ?? []) as { id: string; name: string; kind: "income" | "expense" }[]}
          />
        </section>
      )}

      {/* Список обязательств */}
      {rows.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Все обязательства
          </h2>
          <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                  <th className="px-5 py-3 font-medium">Контрагент</th>
                  <th className="px-5 py-3 font-medium">Тип</th>
                  <th className="px-5 py-3 font-medium">За что</th>
                  <th className="px-5 py-3 text-right font-medium">Остаток</th>
                  <th className="px-5 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                    <td className="px-5 py-3 font-medium text-slate-800 dark:text-neutral-200">
                      {o.counterparty?.name ?? "—"}
                      {o.project?.name && (
                        <span className="ml-2 text-xs text-slate-400">· {o.project.name}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs ${
                          o.type === "receivable"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                        }`}
                      >
                        {o.type === "receivable" ? "Нам должны" : "Мы должны"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500 dark:text-neutral-400">
                      {oblCatName.get(o.id) || o.note || "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-800 dark:text-neutral-200">
                      {formatMoney(o.outstanding, o.currency)}
                      {o.outstanding !== o.amount && (
                        <span className="ml-1 text-xs font-normal text-slate-400">
                          из {formatMoney(o.amount, o.currency)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canEditFinance(role) && user ? (
                        <div className="flex items-center justify-end gap-1">
                          <PlanObligationButton
                            obligationId={o.id}
                            teamId={team.id}
                            userId={user.id}
                            oblType={o.type}
                            outstanding={o.outstanding}
                            currency={o.currency}
                            counterpartyId={o.counterparty_id}
                            categoryId={oblMeta.get(o.id)?.category_id ?? null}
                            projectId={oblMeta.get(o.id)?.project_id ?? null}
                            dueDate={o.due_date}
                            accounts={accounts ?? []}
                            alreadyScheduled={scheduledOblIds.has(o.id)}
                          />
                          <LinkPaymentButton
                            obligationId={o.id}
                            oblType={o.type}
                            counterpartyId={o.counterparty_id}
                            currency={o.currency}
                            outstanding={o.outstanding}
                            teamId={team.id}
                            userId={user.id}
                          />
                          <PayObligationButton
                            obligationId={o.id}
                            userId={user.id}
                            outstanding={o.outstanding}
                            currency={o.currency}
                            teamId={team.id}
                            counterpartyId={o.counterparty_id}
                            accounts={accounts ?? []}
                          />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="mt-4 text-xs text-slate-400 dark:text-neutral-600">
        Итоги сводятся в основной валюте ({cur}) по курсам из раздела «Отчёты».
      </p>
    </div>
  );
}

function Card({
  title,
  value,
  accent,
}: {
  title: string;
  value: string;
  accent: "emerald" | "red";
}) {
  const map = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
  };
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-2 text-xl font-bold ${map[accent]}`}>{value}</div>
    </div>
  );
}

function Toggle({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-4 py-1.5 font-medium transition ${
        active
          ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white"
          : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"
      }`}
    >
      {label}
    </Link>
  );
}
