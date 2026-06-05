import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import AddBudgetForm from "@/components/AddBudgetForm";

const PERIOD_LABELS: Record<string, string> = {
  month: "Месяц",
  quarter: "Квартал",
  year: "Год",
};

function periodEnd(start: string, period: string): Date {
  const d = new Date(start);
  if (period === "year") d.setFullYear(d.getFullYear() + 1);
  else if (period === "quarter") d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export default async function BudgetsPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Бюджеты
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const cur = team.base_currency;
  const supabase = await createClient();

  const yearStart = new Date(new Date().getFullYear(), 0, 1)
    .toISOString()
    .slice(0, 10);

  const [{ data: budgets }, { data: expenses }, { data: categories }] =
    await Promise.all([
      supabase
        .from("budgets")
        .select("id, amount, currency, period, period_start, category:categories(name)")
        .eq("team_id", team.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("transactions")
        .select("category_id, amount, occurred_on")
        .eq("team_id", team.id)
        .eq("type", "expense")
        .gte("occurred_on", yearStart),
      supabase
        .from("categories")
        .select("id, name")
        .eq("team_id", team.id)
        .eq("kind", "expense")
        .eq("archived", false)
        .order("name"),
    ]);

  type Budget = {
    id: string;
    amount: number;
    currency: string;
    period: string;
    period_start: string;
    category: { name: string } | null;
    category_id?: string;
  };

  // Нужен category_id у бюджета для подсчёта — добавим отдельным запросом полей
  const { data: budgetCats } = await supabase
    .from("budgets")
    .select("id, category_id")
    .eq("team_id", team.id);
  const catOf = new Map((budgetCats ?? []).map((b) => [b.id, b.category_id]));

  const exp = expenses ?? [];

  const items = ((budgets ?? []) as unknown as Budget[]).map((b) => {
    const categoryId = catOf.get(b.id);
    const start = b.period_start;
    const end = periodEnd(b.period_start, b.period).toISOString().slice(0, 10);
    let spent = 0;
    for (const t of exp) {
      if (
        t.category_id === categoryId &&
        t.occurred_on >= start &&
        t.occurred_on < end
      ) {
        spent += t.amount;
      }
    }
    const pct = b.amount > 0 ? Math.min((spent / b.amount) * 100, 100) : 0;
    const over = spent > b.amount;
    return { ...b, spent, pct, over };
  });

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Бюджеты
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Лимиты по категориям расходов и контроль превышений
          </p>
        </div>
        {canEditFinance(role) && (
          <AddBudgetForm
            teamId={team.id}
            baseCurrency={cur}
            categories={categories ?? []}
          />
        )}
      </header>

      {items.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((b) => (
            <div
              key={b.id}
              className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-neutral-200">
                    {b.category?.name ?? "Категория"}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-neutral-500">
                    {PERIOD_LABELS[b.period] ?? b.period}
                  </div>
                </div>
                {b.over && (
                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 dark:bg-red-950/40 dark:text-red-300">
                    Превышен
                  </span>
                )}
              </div>

              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                <div
                  className={`h-2.5 rounded-full ${
                    b.over ? "bg-red-500" : b.pct > 80 ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.max(b.pct, 2)}%` }}
                />
              </div>

              <div className="mt-2 flex items-baseline justify-between text-sm">
                <span
                  className={`font-semibold ${
                    b.over ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-neutral-200"
                  }`}
                >
                  {formatMoney(b.spent, cur)}
                </span>
                <span className="text-slate-400 dark:text-neutral-500">
                  из {formatMoney(b.amount, b.currency)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-800">
          Пока нет бюджетов.
          {canEditFinance(role)
            ? " Задайте лимит по категории кнопкой выше."
            : " Их может задать владелец или менеджер."}
        </p>
      )}
    </div>
  );
}
