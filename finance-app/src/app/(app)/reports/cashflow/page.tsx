import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

type Tx = {
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  category: { name: string } | null;
};

export default async function CashflowPage() {
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
  const now = new Date();
  const year = now.getFullYear();
  const monthsCount = now.getMonth() + 1; // Январь..текущий месяц
  const yearStart = `${year}-01-01`;

  const [{ data: txs }, { data: balances }, { data: fxRows }] = await Promise.all([
    supabase
      .from("transactions")
      .select("type, amount, currency, occurred_on, category:categories(name)")
      .eq("team_id", team.id)
      .eq("status", "actual")
      .gte("occurred_on", yearStart),
    supabase.from("account_balances").select("balance, currency").eq("team_id", team.id),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);
  const rows = (txs ?? []) as unknown as Tx[];
  const months = Array.from({ length: monthsCount }, (_, i) => i); // индексы 0..

  const incomeM = new Array(monthsCount).fill(0);
  const expenseM = new Array(monthsCount).fill(0);
  const incomeCat = new Map<string, number[]>();
  const expenseCat = new Map<string, number[]>();

  function bump(map: Map<string, number[]>, name: string, mi: number, v: number) {
    let arr = map.get(name);
    if (!arr) { arr = new Array(monthsCount).fill(0); map.set(name, arr); }
    arr[mi] += v;
  }

  for (const t of rows) {
    const mi = new Date(t.occurred_on).getMonth();
    if (mi >= monthsCount) continue;
    const v = toBase(t.amount, t.currency, rates);
    if (t.type === "income") {
      incomeM[mi] += v;
      bump(incomeCat, t.category?.name ?? "Без статьи", mi, v);
    } else if (t.type === "expense") {
      expenseM[mi] += v;
      bump(expenseCat, t.category?.name ?? "Без статьи", mi, v);
    }
  }

  const saldoM = months.map((i) => incomeM[i] - expenseM[i]);
  const netYTD = saldoM.reduce((s, x) => s + x, 0);
  const currentBalance = (balances ?? []).reduce((s, b) => s + toBase(b.balance, b.currency, rates), 0);
  const openingFirst = currentBalance - netYTD;
  const opening = new Array(monthsCount).fill(0);
  const closing = new Array(monthsCount).fill(0);
  let run = openingFirst;
  for (const i of months) {
    opening[i] = run;
    run += saldoM[i];
    closing[i] = run;
  }

  const incomeCats = [...incomeCat.entries()].sort((a, b) => b[1].reduce((s, x) => s + x, 0) - a[1].reduce((s, x) => s + x, 0));
  const expenseCats = [...expenseCat.entries()].sort((a, b) => b[1].reduce((s, x) => s + x, 0) - a[1].reduce((s, x) => s + x, 0));

  const cell = "whitespace-nowrap px-4 py-2.5 text-right tabular-nums";

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-5">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Движение денежных средств
        </h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          По месяцам, {year} год · в {base} (только фактические операции)
        </p>
      </header>

      <div className="overflow-x-auto rounded-3xl bg-white ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
              <th className="sticky left-0 bg-white px-5 py-3 text-left font-medium dark:bg-[#15171c]">Статья</th>
              {months.map((i) => (
                <th key={i} className="px-4 py-3 text-right font-medium">{MONTHS_RU[i]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label="Деньги на начало периода" values={opening} muted cellCls={cell} base={base} sticky />
            <Row label="Поступления" values={incomeM} bold accent="emerald" cellCls={cell} base={base} sticky />
            {incomeCats.map(([name, arr]) => (
              <Row key={"i" + name} label={name} values={arr} sub cellCls={cell} base={base} sticky />
            ))}
            <Row label="Выплаты" values={expenseM.map((x) => -x)} bold accent="red" cellCls={cell} base={base} sticky />
            {expenseCats.map(([name, arr]) => (
              <Row key={"e" + name} label={name} values={arr.map((x) => -x)} sub cellCls={cell} base={base} sticky />
            ))}
            <Row label="Переводы между счетами" values={months.map(() => 0)} muted cellCls={cell} base={base} sticky />
            <Row label="Сальдо" values={saldoM} bold signed cellCls={cell} base={base} sticky />
            <Row label="Деньги на конец периода" values={closing} bold muted cellCls={cell} base={base} sticky />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  label, values, bold, sub, muted, accent, signed, cellCls, base, sticky,
}: {
  label: string;
  values: number[];
  bold?: boolean;
  sub?: boolean;
  muted?: boolean;
  accent?: "emerald" | "red";
  signed?: boolean;
  cellCls: string;
  base: string;
  sticky?: boolean;
}) {
  const labelColor = muted ? "text-slate-400 dark:text-neutral-500" : "text-slate-800 dark:text-neutral-200";
  function color(v: number) {
    if (signed) return v < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400";
    if (accent === "emerald") return "text-emerald-600 dark:text-emerald-400";
    if (accent === "red") return "text-red-600 dark:text-red-400";
    if (muted) return "text-slate-400 dark:text-neutral-500";
    return "text-slate-600 dark:text-neutral-400";
  }
  return (
    <tr className="border-b border-slate-50 last:border-0 dark:border-white/[0.04]">
      <td className={`${sticky ? "sticky left-0 bg-white dark:bg-[#15171c]" : ""} px-5 py-2.5 ${sub ? "pl-10 text-slate-500 dark:text-neutral-400" : `font-medium ${labelColor}`} ${bold ? "font-semibold" : ""}`}>
        {label}
      </td>
      {values.map((v, i) => (
        <td key={i} className={`${cellCls} ${bold ? "font-semibold" : ""} ${color(v)}`}>
          {v === 0 ? "—" : formatMoney(v, base)}
        </td>
      ))}
    </tr>
  );
}
