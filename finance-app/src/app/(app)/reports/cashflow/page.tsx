import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { buildRateMap, toBase } from "@/lib/fx";
import CashflowTable from "@/components/CashflowTable";
import ReportRangePicker from "@/components/ReportRangePicker";

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

type Tx = {
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  account_id: string | null;
  counterparty_id: string | null;
  project_id: string | null;
  category: { id: string; name: string; cf_activity: string | null } | null;
  account: { name: string } | null;
  counterparty: { name: string } | null;
  project: { name: string } | null;
};

const GROUPS: [string, string][] = [
  ["article", "Статьи"],
  ["activity", "Виды деятельности"],
  ["account", "Счета"],
  ["counterparty", "Контрагенты"],
  ["project", "Проекты"],
];
const ACTIVITY_LABEL: Record<string, string> = { operating: "Операционная", investing: "Инвестиционная", financing: "Финансовая" };

export default async function CashflowPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; group?: string }>;
}) {
  const { period, from: spFrom, to: spTo, group: spGroup } = await searchParams;
  const group = GROUPS.some(([g]) => g === spGroup) ? spGroup! : "article";
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
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const isCustom = period === "custom" && !!spFrom && !!spTo;

  // Диапазон месяцев: по умолчанию — текущий год (Янв..текущий месяц), иначе произвольный
  let startY: number, startM: number, endY: number, endM: number;
  if (isCustom) {
    const [fy, fm] = spFrom!.split("-").map(Number);
    const [ty, tm] = spTo!.split("-").map(Number);
    startY = fy; startM = (fm || 1) - 1;
    endY = ty; endM = (tm || 1) - 1;
    if (endY < startY || (endY === startY && endM < startM)) { endY = startY; endM = startM; }
  } else {
    startY = now.getFullYear(); startM = 0;
    endY = now.getFullYear(); endM = now.getMonth();
  }
  const startDate = `${startY}-${pad2(startM + 1)}-01`;
  const multiYear = startY !== endY;

  const monthsList: { y: number; m: number }[] = [];
  for (let y = startY, m = startM; y < endY || (y === endY && m <= endM); ) {
    monthsList.push({ y, m });
    m++; if (m > 11) { m = 0; y++; }
  }
  const monthsCount = monthsList.length;
  const idxByKey = new Map(monthsList.map((mm, i) => [`${mm.y}-${mm.m}`, i]));

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
      .select("type, amount, currency, occurred_on, account_id, counterparty_id, project_id, category:categories(id, name, cf_activity), account:accounts!transactions_account_id_fkey(name), counterparty:counterparties(name), project:projects(name)")
      .eq("team_id", team.id)
      .eq("status", "actual")
      .gte("occurred_on", startDate)
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

  // totalNetFetched — чистый поток ВСЕХ загруженных операций (>= начала диапазона),
  // нужен для расчёта остатка на начало диапазона от текущего остатка.
  let totalNetFetched = 0;
  for (const t of rows) {
    const d = new Date(t.occurred_on);
    const v = toBase(t.amount, t.currency, rates);
    if (t.type === "income") totalNetFetched += v;
    else if (t.type === "expense") totalNetFetched -= v;
    const mi = idxByKey.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (mi === undefined) continue; // вне отображаемого диапазона (учтено в остатке на начало)
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
  const currentBalance = (balances ?? []).reduce((s, b) => s + toBase(b.balance, b.currency, rates), 0);
  const openingFirst = currentBalance - totalNetFetched;
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
  const monthKeys = monthsList.map((mm) => `${mm.y}-${pad2(mm.m + 1)}`);
  const monthLabels = monthsList.map((mm) => (multiYear ? `${MONTHS_RU[mm.m].slice(0, 3)} ${mm.y}` : MONTHS_RU[mm.m]));

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-5">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Движение денежных средств
        </h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          {isCustom
            ? `${MONTHS_RU[startM]} ${startY} — ${MONTHS_RU[endM]} ${endY}`
            : `${startY} год`}{" "}
          · в {base} (только фактические операции)
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex gap-1 rounded-full bg-slate-100 p-1 text-sm dark:bg-neutral-800">
          <Link
            href="/reports/cashflow"
            className={`rounded-full px-4 py-1.5 font-medium transition ${!isCustom ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"}`}
          >
            Текущий год
          </Link>
          <Link
            href="/reports/cashflow?period=custom"
            className={`rounded-full px-4 py-1.5 font-medium transition ${isCustom ? "bg-white text-brand shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-neutral-400"}`}
          >
            Произвольный
          </Link>
        </div>
        {period === "custom" && <ReportRangePicker basePath="/reports/cashflow" from={spFrom} to={spTo} />}
      </div>

      <CashflowTable
        monthLabels={monthLabels}
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
