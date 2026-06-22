import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
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
  category: { id: string; name: string } | null;
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

  const { team, role } = current;
  const base = team.base_currency;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const now = new Date();
  const year = now.getFullYear();
  const monthsCount = now.getMonth() + 1; // Январь..текущий месяц
  const yearStart = `${year}-01-01`;

  const [{ data: balances }, { data: fxRows }] = await Promise.all([
    supabase.from("account_balances").select("balance, currency").eq("team_id", team.id),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  // Операции за год — постранично: PostgREST отдаёт максимум 1000 строк за запрос,
  // а фактических операций за год больше, иначе поздние месяцы выпадают из отчёта.
  const PAGE = 1000;
  const rows: Tx[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("type, amount, currency, occurred_on, category:categories(id, name)")
      .eq("team_id", team.id)
      .eq("status", "actual")
      .gte("occurred_on", yearStart)
      .order("occurred_on", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error || !data?.length) break;
    rows.push(...(data as unknown as Tx[]));
    if (data.length < PAGE) break;
  }

  const rates = buildRateMap(fxRows ?? [], base);
  const months = Array.from({ length: monthsCount }, (_, i) => i); // индексы 0..

  const incomeM = new Array(monthsCount).fill(0);
  const expenseM = new Array(monthsCount).fill(0);
  const transferM = new Array(monthsCount).fill(0); // переводы между счетами — справочно, вне сальдо
  type CatAgg = { id: string | null; name: string; values: number[] };
  const incomeCat = new Map<string, CatAgg>();
  const expenseCat = new Map<string, CatAgg>();

  function bump(map: Map<string, CatAgg>, id: string | null, name: string, mi: number, v: number) {
    const key = id ?? "none";
    let row = map.get(key);
    if (!row) { row = { id, name, values: new Array(monthsCount).fill(0) }; map.set(key, row); }
    row.values[mi] += v;
  }

  for (const t of rows) {
    const mi = new Date(t.occurred_on).getMonth();
    if (mi >= monthsCount) continue;
    const v = toBase(t.amount, t.currency, rates);
    if (t.type === "income") {
      incomeM[mi] += v;
      bump(incomeCat, t.category?.id ?? null, t.category?.name ?? "Нераспределённые", mi, v);
    } else if (t.type === "expense") {
      expenseM[mi] += v;
      bump(expenseCat, t.category?.id ?? null, t.category?.name ?? "Нераспределённые", mi, v);
    } else if (t.type === "transfer") {
      transferM[mi] += v;
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

  const sum = (a: CatAgg) => a.values.reduce((s, x) => s + x, 0);
  const incomeCats = [...incomeCat.values()].sort((a, b) => sum(b) - sum(a));
  const expenseCats = [...expenseCat.values()].sort((a, b) => sum(b) - sum(a));
  const monthKeys = months.map((i) => `${year}-${String(i + 1).padStart(2, "0")}`);

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
        monthKeys={monthKeys}
        base={base}
        opening={opening}
        incomeM={incomeM}
        incomeCats={incomeCats}
        expenseM={expenseM}
        expenseCats={expenseCats}
        transferM={transferM}
        saldoM={saldoM}
        closing={closing}
        teamId={team.id}
        userId={user?.id ?? ""}
        canEdit={canEditFinance(role)}
      />

      <p className="mt-4 text-xs text-slate-400 dark:text-neutral-600">
        Клик по сумме открывает операции этого месяца. Строка «Нераспределённые» —
        операции без статьи: провалитесь в неё и проставьте статью прямо в списке.
        «Переводы между счетами» показаны справочно и не входят в поступления, выплаты и сальдо.
      </p>
    </div>
  );
}
