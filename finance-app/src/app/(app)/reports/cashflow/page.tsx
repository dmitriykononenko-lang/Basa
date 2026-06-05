import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import { CF_ACTIVITY_LABELS } from "@/lib/constants";

type Tx = {
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  category: { name: string; cf_activity: string } | null;
};

function periodStart(period: string): string {
  const now = new Date();
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  if (period === "quarter")
    return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().slice(0, 10);
  return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
}

const ACTIVITIES = ["operating", "investing", "financial"] as const;

export default async function CashflowPage({
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
          Движение денежных средств
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team } = current;
  const base = team.base_currency;
  const supabase = await createClient();
  const start = periodStart(period);

  const [{ data: txs }, { data: balances }, { data: fxRows }] = await Promise.all([
    supabase
      .from("transactions")
      .select("type, amount, currency, occurred_on, category:categories(name, cf_activity)")
      .eq("team_id", team.id)
      .gte("occurred_on", start),
    supabase.from("account_balances").select("balance, currency").eq("team_id", team.id),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);
  const rows = (txs ?? []) as unknown as Tx[];

  // Структура по видам деятельности
  type Act = { inflow: number; outflow: number; items: Map<string, number> };
  const acts: Record<string, Act> = {
    operating: { inflow: 0, outflow: 0, items: new Map() },
    investing: { inflow: 0, outflow: 0, items: new Map() },
    financial: { inflow: 0, outflow: 0, items: new Map() },
  };

  let inflowTotal = 0;
  let outflowTotal = 0;
  for (const t of rows) {
    if (t.type === "transfer") continue; // переводы между своими счетами не меняют общий остаток
    const v = toBase(t.amount, t.currency, rates);
    const act = t.category?.cf_activity ?? "operating";
    const a = acts[act] ?? acts.operating;
    const name = t.category?.name ?? (t.type === "income" ? "Прочие поступления" : "Прочие выбытия");
    if (t.type === "income") {
      a.inflow += v;
      inflowTotal += v;
      a.items.set(name, (a.items.get(name) ?? 0) + v);
    } else {
      a.outflow += v;
      outflowTotal += v;
      a.items.set(name, (a.items.get(name) ?? 0) - v);
    }
  }

  const netChange = inflowTotal - outflowTotal;
  const closing = (balances ?? []).reduce((s, b) => s + toBase(b.balance, b.currency, rates), 0);
  const opening = closing - netChange;

  const PERIODS: [string, string][] = [
    ["month", "Месяц"],
    ["quarter", "Квартал"],
    ["year", "Год"],
  ];

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Движение денежных средств
        </h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          На что компания тратит и откуда получает деньги ({base})
        </p>
      </header>

      <div className="mb-6 inline-flex gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
        {PERIODS.map(([val, label]) => (
          <Link
            key={val}
            href={`/reports/cashflow?period=${val}`}
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi title="Остаток на начало" value={formatMoney(opening, base)} accent="slate" />
        <Kpi title="Поступления" value={formatMoney(inflowTotal, base)} accent="emerald" />
        <Kpi title="Выбытия" value={formatMoney(outflowTotal, base)} accent="red" />
        <Kpi title="Остаток на конец" value={formatMoney(closing, base)} accent="brand" />
      </div>

      <div className="mt-6 space-y-4">
        {ACTIVITIES.map((key) => {
          const a = acts[key];
          const net = a.inflow - a.outflow;
          const items = [...a.items.entries()].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
          if (a.inflow === 0 && a.outflow === 0) return null;
          return (
            <section
              key={key}
              className="rounded-3xl bg-white p-6 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-200">
                  {CF_ACTIVITY_LABELS[key]} деятельность
                </h2>
                <span className={`text-sm font-bold ${net < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {(net < 0 ? "−" : "+") + formatMoney(Math.abs(net), base)}
                </span>
              </div>
              <ul className="space-y-1.5 text-sm">
                {items.map(([name, val]) => (
                  <li key={name} className="flex justify-between">
                    <span className="text-slate-600 dark:text-neutral-400">{name}</span>
                    <span className={`font-medium ${val < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                      {(val < 0 ? "−" : "+") + formatMoney(Math.abs(val), base)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="mt-6 rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <div className="flex items-center justify-between text-sm font-semibold text-slate-800 dark:text-neutral-200">
          <span>Чистый денежный поток за период</span>
          <span className={netChange < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
            {(netChange < 0 ? "−" : "+") + formatMoney(Math.abs(netChange), base)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Kpi({ title, value, accent }: { title: string; value: string; accent: "emerald" | "red" | "brand" | "slate" }) {
  const map = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    brand: "text-brand",
    slate: "text-slate-700 dark:text-neutral-200",
  };
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-2 text-lg font-bold ${map[accent]}`}>{value}</div>
    </div>
  );
}
