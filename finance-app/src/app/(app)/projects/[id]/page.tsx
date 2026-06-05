import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import { formatMoney, formatDate } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const current = await getCurrentTeam();
  if (!current) notFound();
  const { team } = current;
  const base = team.base_currency;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, status")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const [{ data: txs }, { data: obls }, { data: fxRows }] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, type, amount, currency, occurred_on, category:categories(name), counterparty:counterparties(name)")
      .eq("team_id", team.id)
      .eq("project_id", id)
      .eq("status", "actual")
      .order("occurred_on", { ascending: false })
      .limit(100),
    supabase
      .from("obligation_balances")
      .select("type, amount, outstanding, currency, pay_part, counterparty:counterparties(name)")
      .eq("team_id", team.id)
      .eq("project_id", id),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

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

  return (
    <div className="p-6 sm:p-8">
      <Link href="/projects" className="text-sm text-slate-400 hover:text-brand">
        ← Проекты
      </Link>
      <header className="mb-6 mt-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {project.name}
        </h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">Финансы и маржинальность проекта</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat title="Выручка" value={formatMoney(revenue, base)} accent="emerald" />
        <Stat title="Затраты" value={formatMoney(costs, base)} accent="red" />
        <Stat title="Прибыль" value={formatMoney(profit, base)} accent={profit < 0 ? "red" : "emerald"} />
        <Stat title="Маржинальность" value={`${margin.toFixed(1)}%`} accent={margin < 0 ? "red" : "brand"} />
      </div>

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
