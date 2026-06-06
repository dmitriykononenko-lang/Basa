import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import { buildRateMap, toBase } from "@/lib/fx";
import CashflowTable from "@/components/CashflowTable";

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

      <CashflowTable
        monthLabels={months.map((i) => MONTHS_RU[i])}
        base={base}
        opening={opening}
        incomeM={incomeM}
        incomeCats={incomeCats}
        expenseM={expenseM}
        expenseCats={expenseCats}
        saldoM={saldoM}
        closing={closing}
      />
    </div>
  );
}
