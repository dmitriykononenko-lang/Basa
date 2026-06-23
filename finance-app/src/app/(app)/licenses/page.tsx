import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";
import LicensesView, { type DealView } from "@/components/LicensesView";

type RawPurchase = {
  id: string; amount: number; currency: string; purchased_on: string;
  vendor_counterparty_id: string | null; note: string | null; expense_transaction_id: string | null;
};
type RawDeal = {
  id: string; title: string; sale_amount: number; currency: string; sold_on: string;
  expected_cost: number | null; status: string; note: string | null;
  client_counterparty_id: string | null; project_id: string | null; income_transaction_id: string | null;
  purchases: RawPurchase[] | null;
};
type RawOp = {
  id: string; amount: number; currency: string; occurred_on: string;
  counterparty_id: string | null; counterparty: { name: string } | null;
};

export default async function LicensesPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Лицензии</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { team, role } = current;
  const base = team.base_currency;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: deals }, { data: counterparties }, { data: projects }, { data: fxRows }, { data: licCats }] = await Promise.all([
    supabase
      .from("license_deals")
      .select("id, title, sale_amount, currency, sold_on, expected_cost, status, note, client_counterparty_id, project_id, income_transaction_id, purchases:license_purchases(id, amount, currency, purchased_on, vendor_counterparty_id, note, expense_transaction_id)")
      .eq("team_id", team.id)
      .order("sold_on", { ascending: false }),
    supabase.from("counterparties").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("projects").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
    supabase.from("categories").select("id, kind").eq("team_id", team.id).ilike("name", "%лиценз%"),
  ]);

  // Лицензионные статьи: доходные — для привязки сделок, расходные — для закупок
  const incomeCatIds = (licCats ?? []).filter((c) => c.kind === "income").map((c) => c.id);
  const expenseCatIds = (licCats ?? []).filter((c) => c.kind === "expense").map((c) => c.id);
  // Уже привязанные операции — исключаем из пикеров
  const linkedIncome = (deals ?? []).map((d) => (d as RawDeal).income_transaction_id).filter(Boolean) as string[];
  const linkedExpense = (deals ?? []).flatMap((d) => ((d as RawDeal).purchases ?? []).map((p) => p.expense_transaction_id)).filter(Boolean) as string[];

  async function loadOps(catIds: string[], type: "income" | "expense", exclude: string[]): Promise<RawOp[]> {
    if (catIds.length === 0) return [];
    let qb = supabase
      .from("transactions")
      .select("id, amount, currency, occurred_on, counterparty_id, counterparty:counterparties(name)")
      .eq("team_id", team.id).eq("status", "actual").eq("type", type).in("category_id", catIds)
      .order("occurred_on", { ascending: false }).limit(300);
    if (exclude.length) qb = qb.not("id", "in", `(${exclude.join(",")})`);
    const { data } = await qb;
    return (data ?? []) as unknown as RawOp[];
  }
  const [incomeOpsRaw, expenseOpsRaw] = await Promise.all([
    loadOps(incomeCatIds, "income", linkedIncome),
    loadOps(expenseCatIds, "expense", linkedExpense),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);
  const cpName = new Map((counterparties ?? []).map((c) => [c.id, c.name]));
  const projName = new Map((projects ?? []).map((p) => [p.id, p.name]));

  const dealViews: DealView[] = ((deals ?? []) as RawDeal[]).map((d) => {
    const purchases = (d.purchases ?? []).map((p) => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      purchased_on: p.purchased_on,
      vendorName: p.vendor_counterparty_id ? cpName.get(p.vendor_counterparty_id) ?? null : null,
      note: p.note,
      baseAmount: toBase(p.amount, p.currency, rates),
      linked: !!p.expense_transaction_id,
    }));
    const purchasedBase = purchases.reduce((s, p) => s + p.baseAmount, 0);
    const saleBase = toBase(d.sale_amount, d.currency, rates);
    const expectedBase = d.expected_cost != null ? toBase(d.expected_cost, d.currency, rates) : null;
    const fullyPurchased = expectedBase != null && purchasedBase >= expectedBase - 1;
    const isOpen = d.status !== "closed" && !fullyPurchased;
    const remaining = expectedBase != null ? Math.max(0, expectedBase - purchasedBase) : null;
    return {
      id: d.id,
      title: d.title,
      saleAmount: d.sale_amount,
      currency: d.currency,
      soldOn: d.sold_on,
      expectedCost: d.expected_cost,
      status: d.status,
      note: d.note,
      clientId: d.client_counterparty_id,
      projectId: d.project_id,
      clientName: d.client_counterparty_id ? cpName.get(d.client_counterparty_id) ?? null : null,
      projectName: d.project_id ? projName.get(d.project_id) ?? null : null,
      purchases,
      saleBase,
      purchasedBase,
      expectedBase,
      remaining,
      marginBase: saleBase - purchasedBase,
      isOpen,
      fullyPurchased,
      incomeLinked: !!d.income_transaction_id,
    };
  });

  const mapOp = (o: RawOp) => ({
    id: o.id, amount: o.amount, currency: o.currency, occurred_on: o.occurred_on,
    counterpartyId: o.counterparty_id, counterpartyName: o.counterparty?.name ?? null,
  });
  const incomeOps = incomeOpsRaw.map(mapOp);
  const expenseOps = expenseOpsRaw.map(mapOp);

  const openDeals = dealViews.filter((d) => d.isOpen);
  const notClosedSale = openDeals.reduce((s, d) => s + d.saleBase, 0);
  const remainingToBuy = openDeals.reduce((s, d) => s + (d.remaining ?? 0), 0);
  const hasEstimates = openDeals.some((d) => d.remaining != null);

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Лицензии</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Реестр сделок: продажа клиенту ↔ закупка у вендора · в {base}
        </p>
      </header>

      {/* Что висит */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Summary title="Не закрыто закупкой" value={formatMoney(notClosedSale, base)} hint="продажа по открытым сделкам" tone="amber" />
        <Summary title="Осталось закупить (оценка)" value={hasEstimates ? formatMoney(remainingToBuy, base) : "—"} hint={hasEstimates ? "по сделкам с ожидаемой закупкой" : "укажите ожидаемую закупку в сделке"} tone="brand" />
        <Summary title="Открытых сделок" value={String(openDeals.length)} hint="оплачено клиентом, не выкуплено" tone="slate" />
      </div>

      <LicensesView
        deals={dealViews}
        counterparties={(counterparties ?? []) as { id: string; name: string }[]}
        projects={(projects ?? []) as { id: string; name: string }[]}
        incomeOps={incomeOps}
        expenseOps={expenseOps}
        teamId={team.id}
        userId={user?.id ?? ""}
        base={base}
        canEdit={canEditFinance(role)}
      />

      <p className="mt-4 text-xs text-slate-400 dark:text-neutral-600">
        «Не закрыто закупкой» — деньги клиентов по сделкам, которые ещё не выкуплены у вендора полностью.
        Добавляйте закупки частями; сделка закрывается, когда закупка достигнет ожидаемой или вручную.
      </p>
    </div>
  );
}

function Summary({ title, value, hint, tone }: { title: string; value: string; hint: string; tone: "amber" | "brand" | "slate" }) {
  const map = {
    amber: "text-amber-600 dark:text-amber-400",
    brand: "text-brand",
    slate: "text-slate-900 dark:text-white",
  };
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]">
      <div className="text-sm text-slate-500 dark:text-neutral-400">{title}</div>
      <div className={`mt-1.5 text-2xl font-bold ${map[tone]}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-400 dark:text-neutral-500">{hint}</div>
    </div>
  );
}
