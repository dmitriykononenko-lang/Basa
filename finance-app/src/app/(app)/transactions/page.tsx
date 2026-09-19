import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canWriteTx, canEditFinance } from "@/lib/team";
import AddTransactionForm from "@/components/AddTransactionForm";
import TransactionsFilter from "@/components/TransactionsFilter";
import EmptyState from "@/components/EmptyState";
import PlannedReview from "@/components/PlannedReview";
import ExportButton from "@/components/ExportButton";
import OperationsTable from "@/components/OperationsTable";
import { PaginationNav } from "@/components/ui/pagination";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import { fetchCbrRates, type CbrRates } from "@/lib/cbr";

type TxRow = {
  id: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  currency: string;
  occurred_on: string;
  accrual_date: string | null;
  note: string | null;
  status: string;
  account_id: string | null;
  transfer_account_id: string | null;
  transfer_amount: number | null;
  transfer_currency: string | null;
  category_id: string | null;
  counterparty_id: string | null;
  project_id: string | null;
  created_by: string | null;
  import_batch_id: string | null;
  account: { name: string } | null;
  to_account: { name: string } | null;
  category: { name: string } | null;
  counterparty: { name: string } | null;
  project: { name: string } | null;
};

function periodRange(period: string, from?: string, to?: string): { gte: string | null; lte: string | null } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (period === "custom") return { gte: from || null, lte: to || null };
  if (period === "last_month") {
    return { gte: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), lte: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) };
  }
  if (period === "quarter") return { gte: fmt(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), lte: null };
  if (period === "year") return { gte: fmt(new Date(now.getFullYear(), 0, 1)), lte: null };
  if (period === "all") return { gte: null, lte: null };
  return { gte: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), lte: null }; // month
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const period = sp.period ?? "month";
  const fType = sp.type ?? "all";
  const fStatus = sp.status ?? "all";
  const fAccount = sp.account ?? "all";
  const fProject = sp.project ?? "all";
  const fCp = sp.counterparty ?? "all";
  const fCat = sp.category ?? "all";
  const q = sp.q ?? "";

  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Операции</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }

  const { team, role } = current;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: accounts }, { data: categories }, { data: counterparties }, { data: projects }, { count: plannedCount }] = await Promise.all([
    supabase.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false).order("created_at"),
    supabase.from("categories").select("id, name, kind").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("counterparties").select("id, name, inn").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("projects").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("team_id", team.id).eq("status", "planned"),
  ]);

  const { gte, lte } = periodRange(period, sp.from, sp.to);
  const PAGE_SIZE = 50;
  const rawPage = Math.max(1, Number(sp.page) || 1);

  // Одни и те же фильтры применяем и к выборке страницы, и к подсчёту total.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (qb: any) => {
    if (gte) qb = qb.gte("occurred_on", gte);
    if (lte) qb = qb.lte("occurred_on", lte);
    if (fType !== "all") qb = qb.eq("type", fType);
    if (fStatus !== "all") qb = qb.eq("status", fStatus);
    if (fAccount !== "all") qb = qb.or(`account_id.eq.${fAccount},transfer_account_id.eq.${fAccount}`);
    if (fProject !== "all") qb = qb.eq("project_id", fProject);
    if (fCp !== "all") qb = qb.eq("counterparty_id", fCp);
    if (fCat !== "all") qb = qb.eq("category_id", fCat);
    if (q) qb = qb.ilike("note", `%${q}%`);
    return qb;
  };

  const { count: totalCount } = await applyFilters(
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("team_id", team.id),
  );
  const totalPages = Math.max(1, Math.ceil((totalCount ?? 0) / PAGE_SIZE));
  // Не даём выйти за пределы: устаревший page из URL/фильтра → пустая страница.
  const page = Math.min(rawPage, totalPages);

  const { data: txs } = await applyFilters(
    supabase
      .from("transactions")
      .select(
        `id, type, amount, currency, occurred_on, accrual_date, note, status,
         account_id, transfer_account_id, transfer_amount, transfer_currency, category_id, counterparty_id, project_id, created_by, import_batch_id,
         account:accounts!transactions_account_id_fkey(name),
         to_account:accounts!transactions_transfer_account_id_fkey(name),
         category:categories(name),
         counterparty:counterparties(name),
         project:projects(name)`,
      )
      .eq("team_id", team.id),
  )
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  // Ссылки пагинации сохраняют текущие фильтры.
  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v != null && v !== "" && k !== "page") params.set(k, String(v));
    }
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/transactions?${qs}` : "/transactions";
  };
  const rows = (txs ?? []) as unknown as TxRow[];
  const writable = canWriteTx(role) && (accounts?.length ?? 0) > 0;
  const cats = (categories ?? []) as { id: string; name: string; kind: "income" | "expense" }[];

  // Вложения
  const txIds = rows.map((r) => r.id);
  const { data: atts } = txIds.length
    ? await supabase.from("attachments").select("id, transaction_id, storage_path, file_name").in("transaction_id", txIds)
    : { data: [] };
  const attByTx = new Map<string, { id: string; storage_path: string; file_name: string }[]>();
  for (const a of atts ?? []) {
    const arr = attByTx.get(a.transaction_id) ?? [];
    arr.push({ id: a.id, storage_path: a.storage_path, file_name: a.file_name });
    attByTx.set(a.transaction_id, arr);
  }

  // Число частей операции (внутренний split) — для индикатора в списке
  const { data: splitCnt } = txIds.length
    ? await supabase.from("transaction_splits").select("transaction_id").in("transaction_id", txIds)
    : { data: [] };
  const splitByTx = new Map<string, number>();
  for (const s of (splitCnt ?? []) as { transaction_id: string }[]) splitByTx.set(s.transaction_id, (splitByTx.get(s.transaction_id) ?? 0) + 1);

  // ── Сводка за период (факт) для KPI-карточек ──
  // Те же фильтры, что и у таблицы, кроме типа и статуса: считаем только факт.
  const base = team.base_currency;
  let kq = supabase.from("transactions").select("type, amount, currency").eq("team_id", team.id).eq("status", "actual");
  if (gte) kq = kq.gte("occurred_on", gte);
  if (lte) kq = kq.lte("occurred_on", lte);
  if (fAccount !== "all") kq = kq.or(`account_id.eq.${fAccount},transfer_account_id.eq.${fAccount}`);
  if (fProject !== "all") kq = kq.eq("project_id", fProject);
  if (fCp !== "all") kq = kq.eq("counterparty_id", fCp);
  if (fCat !== "all") kq = kq.eq("category_id", fCat);
  if (q) kq = kq.ilike("note", `%${q}%`);
  // Курсы валют: ручные (fx_rates) + ЦБ РФ для валют без ручного курса (USD/USDT).
  // Нужны, чтобы свести приток/отток/чистый поток к одной (базовой) валюте.
  const [{ data: kpiRows }, { data: fxRows }, cbr] = await Promise.all([
    kq,
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
    base === "RUB" ? fetchCbrRates() : Promise.resolve<CbrRates>({ rates: {}, date: null }),
  ]);
  const rates = buildRateMap(fxRows ?? [], base);
  for (const [cur, r] of Object.entries(cbr.rates)) {
    if (rates[cur] === undefined) rates[cur] = r;
  }

  // Всё считаем в базовой валюте (валютные операции конвертируются по курсу).
  let inflow = 0, outflow = 0, outflowCount = 0;
  let hasForeign = false;
  for (const t of (kpiRows ?? []) as { type: string; amount: number; currency: string }[]) {
    if (t.currency !== base) hasForeign = true;
    const val = toBase(t.amount, t.currency, rates);
    if (t.type === "income") inflow += val;
    else if (t.type === "expense") { outflowCount += 1; outflow += val; }
  }
  const netBase = inflow - outflow;
  const convHint = hasForeign ? "валюты по курсу" : null;

  const PERIOD_LABELS: Record<string, string> = {
    month: "Текущий месяц", last_month: "Прошлый месяц", quarter: "Квартал",
    year: "Год", all: "Всё время", custom: "Период",
  };
  const periodLabel = PERIOD_LABELS[period] ?? "Текущий месяц";

  const exportRows = rows.map((t) => [
    t.occurred_on,
    t.type === "income" ? "Приход" : t.type === "expense" ? "Расход" : "Перевод",
    (t.amount / 100).toFixed(2).replace(".", ","),
    t.currency,
    t.category?.name ?? "",
    t.project?.name ?? "",
    t.counterparty?.name ?? "",
    t.account?.name ?? "",
    t.status === "planned" ? "План" : "Факт",
    t.note ?? "",
  ]);

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Операции</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            {periodLabel} · {totalCount ?? 0} {plOps(totalCount ?? 0)}
            {(plannedCount ?? 0) > 0 ? ` · ${plannedCount} плановых` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButton
            headers={["Дата", "Тип", "Сумма", "Валюта", "Статья", "Проект", "Контрагент", "Счёт", "Статус", "Комментарий"]}
            rows={exportRows}
            filename={`operations-${period}.csv`}
          />
          {writable && user && (plannedCount ?? 0) > 0 && (
            <PlannedReview teamId={team.id} count={plannedCount ?? 0} variant="button" />
          )}
          {writable && user && (
            <Link
              href="/transactions/categorize"
              className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition hover:bg-brand/20"
            >
              ✨ Распределить статьи
            </Link>
          )}
          {writable && user && (
            <Link
              href="/transactions/import"
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              ⬆ Импорт выписки
            </Link>
          )}
        </div>
      </header>

      {/* KPI за период */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard tone="income" label="Приток за период" value={`+${formatMoney(inflow, base)}`} sub={convHint} />
        <KpiCard tone="expense" label="Отток за период" value={`−${formatMoney(outflow, base)}`} sub={outflowCount ? `${outflowCount} ${plOps(outflowCount)}` : convHint} />
        <KpiCard tone="net" label="Чистый поток" value={`${netBase >= 0 ? "+" : "−"}${formatMoney(Math.abs(netBase), base)}`} sub={convHint ? "итог за период · в базовой валюте" : "итог за период"} />
        <KpiCard tone="pending" label="Требуют проведения" value={String(plannedCount ?? 0)} sub="плановые к проведению" />
      </div>

      {writable && user && (
        <div className="mb-5">
          <AddTransactionForm teamId={team.id} userId={user.id} accounts={accounts ?? []} categories={cats} counterparties={counterparties ?? []} projects={projects ?? []} />
        </div>
      )}

      {!writable && canWriteTx(role) && (
        <p className="mb-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          Сначала добавьте хотя бы один счёт в разделе «Счета».
        </p>
      )}

      <TransactionsFilter
        accounts={accounts ?? []}
        projects={projects ?? []}
        counterparties={counterparties ?? []}
        categories={(categories ?? []).map((c) => ({ id: c.id, name: c.name }))}
      />

      {rows.length > 0 ? (
        <OperationsTable
          items={rows.map((t) => ({
            editable: canEditFinance(role) || (role === "employee" && t.created_by === user?.id),
            attachments: attByTx.get(t.id) ?? [],
            tx: {
              id: t.id, type: t.type, amount: t.amount, currency: t.currency, occurred_on: t.occurred_on,
              accrual_date: t.accrual_date, note: t.note, status: t.status, account_id: t.account_id, transfer_account_id: t.transfer_account_id,
              transfer_amount: t.transfer_amount, transfer_currency: t.transfer_currency,
              category_id: t.category_id, counterparty_id: t.counterparty_id, project_id: t.project_id,
              import_batch_id: t.import_batch_id,
              accountName: t.account?.name ?? null, toAccountName: t.to_account?.name ?? null,
              categoryName: t.category?.name ?? null, counterpartyName: t.counterparty?.name ?? null,
              projectName: t.project?.name ?? null,
              splitCount: splitByTx.get(t.id) ?? 0,
            },
          }))}
          accounts={accounts ?? []}
          categories={cats}
          counterparties={counterparties ?? []}
          projects={projects ?? []}
          teamId={team.id}
          userId={user?.id ?? ""}
        />
      ) : page > 1 ? (
        <p className="py-10 text-center text-sm text-slate-500 dark:text-neutral-400">На этой странице операций нет.</p>
      ) : (
        <EmptyState
          icon="🧾"
          title="Операций пока нет"
          description="Добавьте первую операцию кнопками выше или загрузите банковскую выписку — суммы и статьи подставятся автоматически."
          ctaLabel="Импорт выписки"
          ctaHref="/transactions/import"
        />
      )}

      <PaginationNav page={page} totalPages={totalPages} hrefFor={buildHref} />
      {totalCount != null && totalCount > 0 && (
        <p className="mt-2 text-center text-xs text-slate-400 dark:text-neutral-600">
          Страница {page} из {totalPages} · всего операций: {totalCount}
        </p>
      )}
    </div>
  );
}

// Склонение слова «операция» по числу.
function plOps(n: number): string {
  const a = Math.abs(n) % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return "операций";
  if (b === 1) return "операция";
  if (b >= 2 && b <= 4) return "операции";
  return "операций";
}

// KPI-карточка сводки за период.
function KpiCard({
  tone,
  label,
  value,
  sub,
}: {
  tone: "income" | "expense" | "net" | "pending";
  label: string;
  value: string;
  sub: string | null;
}) {
  const dot = {
    income: "bg-emerald-500",
    expense: "bg-red-500",
    net: "bg-slate-800 dark:bg-white",
    pending: "bg-amber-500",
  }[tone];
  const valueColor = {
    income: "text-emerald-600 dark:text-emerald-400",
    expense: "text-red-600 dark:text-red-400",
    net: "text-slate-900 dark:text-white",
    pending: "text-slate-900 dark:text-white",
  }[tone];
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.06]">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-neutral-400">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</div>
      <div className="mt-1 min-h-[1rem] text-xs text-slate-400 dark:text-neutral-500">{sub}</div>
    </div>
  );
}
