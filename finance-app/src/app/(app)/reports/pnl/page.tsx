import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import PnlTable from "@/components/PnlTable";

type Tx = {
  id: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  accrual_date: string | null;
  project_id: string | null;
  category: { id: string; name: string; kind: string; cf_activity: string; pnl_treatment: string } | null;
};
type Obl = {
  type: "receivable" | "payable";
  amount: number;
  currency: string;
  period_month: string | null;
  due_date: string | null;
  project_id: string | null;
  category: { id: string; name: string; cf_activity: string; pnl_treatment: string } | null;
};
type CatAgg = { id: string | null; name: string; value: number };

function periodStart(period: string): string {
  const now = new Date();
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  if (period === "quarter")
    return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().slice(0, 10);
  return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
}

export default async function PnlPage({
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
          Прибыли и убытки
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
  const { data: { user } } = await supabase.auth.getUser();
  const start = periodStart(period);
  const todayStr = new Date().toISOString().slice(0, 10);

  const [{ data: txs }, { data: fxRows }] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, type, amount, currency, occurred_on, accrual_date, project_id, category:categories(id, name, kind, cf_activity, pnl_treatment)")
      .eq("team_id", team.id)
      .eq("status", "actual")
      .or(`occurred_on.gte.${start},accrual_date.gte.${start}`),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  // Метод начисления: расход/доход признаём при начислении (обязательства), а не при оплате.
  // Поэтому: 1) оплаты обязательств исключаем из транзакций ОПиУ; 2) добавляем начисленные обязательства.
  const [{ data: payRows }, { data: oblRows }] = await Promise.all([
    supabase.from("obligation_payments").select("transaction_id").not("transaction_id", "is", null),
    supabase
      .from("obligations")
      .select("type, amount, currency, period_month, due_date, project_id, category:categories(id, name, cf_activity, pnl_treatment)")
      .eq("team_id", team.id),
  ]);
  const settledTx = new Set((payRows ?? []).map((p) => p.transaction_id as string));

  const rates = buildRateMap(fxRows ?? [], base);
  const rows = (txs ?? []) as unknown as Tx[];

  const revenueByCat = new Map<string, CatAgg>();
  const directByCat = new Map<string, CatAgg>();
  const indirectByCat = new Map<string, CatAgg>();
  const otherByCat = new Map<string, CatAgg>();
  let revenue = 0, direct = 0, indirect = 0, other = 0;

  function add(map: Map<string, CatAgg>, id: string | null, name: string, v: number) {
    const key = id ?? "none:" + name;
    const row = map.get(key) ?? { id, name, value: 0 };
    row.value += v;
    map.set(key, row);
  }

  for (const t of rows) {
    if (t.type === "transfer") continue;
    if (settledTx.has(t.id)) continue; // оплата обязательства — расход уже признан при начислении
    // Метод начисления: операция относится к периоду по дате начисления (если задана)
    const eff = t.accrual_date ?? t.occurred_on;
    if (eff < start) continue;
    const cat = t.category;
    const treatment = cat?.pnl_treatment ?? "auto";
    const activity = cat?.cf_activity ?? "operating";
    if (treatment === "excluded") continue;
    if (activity !== "operating") continue; // капвложения и финансовые потоки не входят в ОПиУ
    const v = toBase(t.amount, t.currency, rates);
    const id = cat?.id ?? null;
    const name = cat?.name ?? (t.type === "income" ? "Прочая выручка" : "Прочие расходы");

    if (t.type === "income") {
      revenue += v;
      add(revenueByCat, id, name, v);
    } else {
      const bucket =
        treatment === "direct" ? "direct"
        : treatment === "indirect" ? "indirect"
        : treatment === "other" ? "other"
        : t.project_id ? "direct" : "indirect"; // auto
      if (bucket === "direct") { direct += v; add(directByCat, id, name, v); }
      else if (bucket === "indirect") { indirect += v; add(indirectByCat, id, name, v); }
      else { other += v; add(otherByCat, id, name, v); }
    }
  }
  // Начисленные обязательства (в т.ч. неоплаченные) — по периоду начисления
  for (const o of (oblRows ?? []) as unknown as Obl[]) {
    const eff = o.period_month ?? o.due_date;
    if (!eff || eff < start) continue;
    const cat = o.category;
    const treatment = cat?.pnl_treatment ?? "auto";
    const activity = cat?.cf_activity ?? "operating";
    if (treatment === "excluded") continue;
    if (activity !== "operating") continue;
    const v = toBase(o.amount, o.currency, rates);
    const id = cat?.id ?? null;
    if (o.type === "receivable") {
      revenue += v;
      add(revenueByCat, id, cat?.name ?? "Начисленная выручка", v);
    } else {
      const bucket =
        treatment === "direct" ? "direct"
        : treatment === "indirect" ? "indirect"
        : treatment === "other" ? "other"
        : o.project_id ? "direct" : "indirect";
      const name = cat?.name ?? "Оплата труда и начисления";
      if (bucket === "direct") { direct += v; add(directByCat, id, name, v); }
      else if (bucket === "indirect") { indirect += v; add(indirectByCat, id, name, v); }
      else { other += v; add(otherByCat, id, name, v); }
    }
  }

  const sortCats = (m: Map<string, CatAgg>) => [...m.values()].sort((a, b) => b.value - a.value);

  const gross = revenue - direct;
  const operating = gross - indirect;
  const net = operating - other;
  const pct = (x: number) => (revenue > 0 ? `${((x / revenue) * 100).toFixed(1)}%` : "—");

  const PERIODS: [string, string][] = [["month", "Месяц"], ["quarter", "Квартал"], ["year", "Год"]];

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Прибыли и убытки
        </h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Сколько чистой прибыли зарабатывает бизнес ({base})
        </p>
      </header>

      <div className="mb-6 inline-flex gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
        {PERIODS.map(([val, label]) => (
          <Link
            key={val}
            href={`/reports/pnl?period=${val}`}
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
        <Kpi title="Выручка" value={formatMoney(revenue, base)} accent="emerald" />
        <Kpi title="Валовая прибыль" value={formatMoney(gross, base)} sub={`маржа ${pct(gross)}`} accent={gross < 0 ? "red" : "slate"} />
        <Kpi title="Операционная прибыль" value={formatMoney(operating, base)} sub={`${pct(operating)}`} accent={operating < 0 ? "red" : "slate"} />
        <Kpi title="Чистая прибыль" value={formatMoney(net, base)} sub={`${pct(net)}`} accent={net < 0 ? "red" : "brand"} />
      </div>

      <PnlTable
        base={base}
        revenue={revenue} revenueCats={sortCats(revenueByCat)}
        direct={direct} directCats={sortCats(directByCat)}
        indirect={indirect} indirectCats={sortCats(indirectByCat)}
        other={other} otherCats={sortCats(otherByCat)}
        gross={gross} operating={operating} net={net}
        teamId={team.id} userId={user?.id ?? ""} canEdit={canEditFinance(role)}
        dateFrom={start} dateTo={todayStr}
      />

      <p className="mt-4 text-xs text-slate-400 dark:text-neutral-600">
        Метод начисления: доходы и расходы признаются в периоде <b>начисления</b>, а не оплаты.
        Учитываются начисленные обязательства (в т.ч. неоплаченные, по их периоду), а оплаты
        этих обязательств в ОПиУ не дублируются. Дата начисления операции (если задана) задаёт
        её период. Капвложения и финансовые потоки исключены; тип расхода берётся из настроек статьи.
      </p>
    </div>
  );
}

function Kpi({ title, value, sub, accent }: { title: string; value: string; sub?: string; accent: "emerald" | "red" | "brand" | "slate" }) {
  const map = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    brand: "text-brand",
    slate: "text-slate-900 dark:text-white",
  };
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-2 text-lg font-bold ${map[accent]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
