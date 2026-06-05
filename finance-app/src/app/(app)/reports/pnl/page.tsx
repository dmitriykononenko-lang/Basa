import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";

type Tx = {
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  project_id: string | null;
  category: { name: string; kind: string; cf_activity: string; pnl_treatment: string } | null;
};

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

  const { team } = current;
  const base = team.base_currency;
  const supabase = await createClient();
  const start = periodStart(period);

  const [{ data: txs }, { data: fxRows }] = await Promise.all([
    supabase
      .from("transactions")
      .select("type, amount, currency, occurred_on, project_id, category:categories(name, kind, cf_activity, pnl_treatment)")
      .eq("team_id", team.id)
      .gte("occurred_on", start),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);
  const rows = (txs ?? []) as unknown as Tx[];

  const revenueByCat = new Map<string, number>();
  const directByCat = new Map<string, number>();
  const indirectByCat = new Map<string, number>();
  const otherByCat = new Map<string, number>();
  let revenue = 0, direct = 0, indirect = 0, other = 0;

  for (const t of rows) {
    if (t.type === "transfer") continue;
    const cat = t.category;
    const treatment = cat?.pnl_treatment ?? "auto";
    const activity = cat?.cf_activity ?? "operating";
    if (treatment === "excluded") continue;
    if (activity !== "operating") continue; // капвложения и финансовые потоки не входят в ОПиУ
    const v = toBase(t.amount, t.currency, rates);
    const name = cat?.name ?? (t.type === "income" ? "Прочая выручка" : "Прочие расходы");

    if (t.type === "income") {
      revenue += v;
      revenueByCat.set(name, (revenueByCat.get(name) ?? 0) + v);
    } else {
      const bucket =
        treatment === "direct" ? "direct"
        : treatment === "indirect" ? "indirect"
        : treatment === "other" ? "other"
        : t.project_id ? "direct" : "indirect"; // auto
      if (bucket === "direct") { direct += v; directByCat.set(name, (directByCat.get(name) ?? 0) + v); }
      else if (bucket === "indirect") { indirect += v; indirectByCat.set(name, (indirectByCat.get(name) ?? 0) + v); }
      else { other += v; otherByCat.set(name, (otherByCat.get(name) ?? 0) + v); }
    }
  }

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

      <div className="mt-6 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <table className="w-full text-sm">
          <tbody>
            <SectionRow label="Выручка" value={formatMoney(revenue, base)} bold accent="emerald" />
            {[...revenueByCat.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => (
              <ItemRow key={"r" + n} name={n} value={"+" + formatMoney(v, base)} />
            ))}

            <SectionRow label="Прямые расходы" value={"−" + formatMoney(direct, base)} accent="red" />
            {[...directByCat.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => (
              <ItemRow key={"d" + n} name={n} value={"−" + formatMoney(v, base)} />
            ))}
            <SectionRow label="Валовая прибыль" value={formatMoney(gross, base)} bold subtotal />

            <SectionRow label="Косвенные расходы" value={"−" + formatMoney(indirect, base)} accent="red" />
            {[...indirectByCat.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => (
              <ItemRow key={"i" + n} name={n} value={"−" + formatMoney(v, base)} />
            ))}
            <SectionRow label="Операционная прибыль" value={formatMoney(operating, base)} bold subtotal />

            {other > 0 && (
              <>
                <SectionRow label="Прочие расходы" value={"−" + formatMoney(other, base)} accent="red" />
                {[...otherByCat.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => (
                  <ItemRow key={"o" + n} name={n} value={"−" + formatMoney(v, base)} />
                ))}
              </>
            )}

            <tr className="border-t-2 border-slate-200 dark:border-white/10">
              <td className="px-5 py-4 text-base font-bold text-slate-900 dark:text-white">Чистая прибыль</td>
              <td className={`px-5 py-4 text-right text-base font-bold ${net < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                {formatMoney(net, base)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-400 dark:text-neutral-600">
        В ОПиУ учитываются операционные доходы и расходы. Капвложения (инвестиционные)
        и финансовые потоки (кредиты, ввод/вывод денег) исключены. Тип расхода
        (прямой/косвенный) берётся из настроек статьи; «авто» = прямой, если у операции
        есть проект, иначе косвенный.
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

function SectionRow({ label, value, bold, subtotal, accent }: { label: string; value: string; bold?: boolean; subtotal?: boolean; accent?: "emerald" | "red" }) {
  const color = accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" : accent === "red" ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white";
  return (
    <tr className={`border-b border-slate-100 dark:border-white/[0.06] ${subtotal ? "bg-slate-50/60 dark:bg-white/[0.02]" : ""}`}>
      <td className={`px-5 py-2.5 ${bold ? "font-semibold text-slate-900 dark:text-white" : "font-medium text-slate-600 dark:text-neutral-300"}`}>{label}</td>
      <td className={`px-5 py-2.5 text-right font-semibold ${bold ? color : color}`}>{value}</td>
    </tr>
  );
}

function ItemRow({ name, value }: { name: string; value: string }) {
  return (
    <tr className="border-b border-slate-50 dark:border-white/[0.04]">
      <td className="px-5 py-2 pl-10 text-slate-500 dark:text-neutral-400">{name}</td>
      <td className="px-5 py-2 text-right text-slate-500 dark:text-neutral-400">{value}</td>
    </tr>
  );
}
