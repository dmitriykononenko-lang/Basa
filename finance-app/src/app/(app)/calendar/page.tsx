import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import { formatMoney, formatDate } from "@/lib/format";
import { buildRateMap, toBase } from "@/lib/fx";

type Ob = {
  type: "receivable" | "payable";
  outstanding: number;
  currency: string;
  due_date: string | null;
  counterparty: { name: string } | null;
};

export default async function CalendarPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Платёжный календарь
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

  const [{ data: balances }, { data: obls }, { data: planned }, { data: fxRows }] = await Promise.all([
    supabase.from("account_balances").select("balance, currency").eq("team_id", team.id),
    supabase
      .from("obligation_balances")
      .select("type, outstanding, currency, due_date, counterparty:counterparties(name)")
      .eq("team_id", team.id)
      .gt("outstanding", 0)
      .not("due_date", "is", null)
      .order("due_date", { ascending: true }),
    supabase
      .from("transactions")
      .select("type, amount, currency, occurred_on, counterparty:counterparties(name)")
      .eq("team_id", team.id)
      .eq("status", "planned"),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  const rates = buildRateMap(fxRows ?? [], base);
  const startBalance = (balances ?? []).reduce((s, b) => s + toBase(b.balance, b.currency, rates), 0);
  const rows = (obls ?? []) as unknown as Ob[];

  // Группируем по дате
  const byDate = new Map<string, { inflow: number; outflow: number; items: { name: string; amount: number; type: string }[] }>();
  for (const o of rows) {
    const d = o.due_date!;
    const v = toBase(o.outstanding, o.currency, rates);
    const g = byDate.get(d) ?? { inflow: 0, outflow: 0, items: [] };
    if (o.type === "receivable") g.inflow += v;
    else g.outflow += v;
    g.items.push({ name: o.counterparty?.name ?? "—", amount: v, type: o.type });
    byDate.set(d, g);
  }

  // Плановые операции
  for (const t of (planned ?? []) as unknown as {
    type: "income" | "expense" | "transfer";
    amount: number;
    currency: string;
    occurred_on: string;
    counterparty: { name: string } | null;
  }[]) {
    if (t.type === "transfer") continue;
    const d = t.occurred_on;
    const v = toBase(t.amount, t.currency, rates);
    const g = byDate.get(d) ?? { inflow: 0, outflow: 0, items: [] };
    if (t.type === "income") g.inflow += v;
    else g.outflow += v;
    g.items.push({ name: (t.counterparty?.name ?? "Плановая") + " (план)", amount: v, type: t.type });
    byDate.set(d, g);
  }

  const dates = [...byDate.keys()].sort();
  const today = new Date().toISOString().slice(0, 10);

  let running = startBalance;
  let minRunning = startBalance;
  let minDate: string | null = null;
  const timeline = dates.map((d) => {
    const g = byDate.get(d)!;
    running += g.inflow - g.outflow;
    if (running < minRunning) {
      minRunning = running;
      minDate = d;
    }
    return { date: d, ...g, running };
  });

  let totalIn = 0;
  let totalOut = 0;
  for (const g of byDate.values()) {
    totalIn += g.inflow;
    totalOut += g.outflow;
  }
  const endBalance = startBalance + totalIn - totalOut;
  const hasGap = minRunning < 0;

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Платёжный календарь
        </h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Прогноз баланса по срокам обязательств — для контроля кассовых разрывов ({base})
        </p>
      </header>

      {hasGap && (
        <div className="mb-6 rounded-3xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/40">
          🚨 Прогнозируется <b>кассовый разрыв</b>: баланс опустится до{" "}
          <b>{formatMoney(minRunning, base)}</b>
          {minDate && <> к {formatDate(minDate)}</>}. Подвиньте платежи или ускорьте поступления.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi title="Сейчас на счетах" value={formatMoney(startBalance, base)} accent="brand" />
        <Kpi title="Ожидается поступлений" value={formatMoney(totalIn, base)} accent="emerald" />
        <Kpi title="Ожидается выплат" value={formatMoney(totalOut, base)} accent="red" />
        <Kpi title="Прогноз баланса" value={formatMoney(endBalance, base)} accent={endBalance < 0 ? "red" : "slate"} />
      </div>

      <section className="mt-6">
        {timeline.length > 0 ? (
          <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:ring-white/[0.07]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-white/[0.07] dark:text-neutral-500">
                  <th className="px-5 py-3 font-medium">Дата</th>
                  <th className="px-5 py-3 text-right font-medium">Поступления</th>
                  <th className="px-5 py-3 text-right font-medium">Выплаты</th>
                  <th className="px-5 py-3 text-right font-medium">Прогноз баланса</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((t) => {
                  const overdue = t.date < today;
                  return (
                    <tr key={t.date} className="border-b border-slate-50 last:border-0 dark:border-white/[0.05]">
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600 dark:text-neutral-300">
                        {formatDate(t.date)}
                        {overdue && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">просрочено</span>}
                      </td>
                      <td className="px-5 py-3 text-right text-emerald-600 dark:text-emerald-400">
                        {t.inflow > 0 ? "+" + formatMoney(t.inflow, base) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-red-600 dark:text-red-400">
                        {t.outflow > 0 ? "−" + formatMoney(t.outflow, base) : "—"}
                      </td>
                      <td className={`px-5 py-3 text-right font-semibold ${t.running < 0 ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-neutral-200"}`}>
                        {formatMoney(t.running, base)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
            Нет запланированных обязательств со сроками. Добавьте долги/начисления со
            сроком оплаты — и они появятся в календаре.
          </p>
        )}
      </section>

      <p className="mt-4 text-xs text-slate-400 dark:text-neutral-600">
        Календарь строится по срокам (due_date) непогашенных обязательств: дебиторка —
        ожидаемые поступления, кредиторка (включая зарплату) — ожидаемые выплаты.
      </p>
    </div>
  );
}

function Kpi({ title, value, accent }: { title: string; value: string; accent: "emerald" | "red" | "brand" | "slate" }) {
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
    </div>
  );
}
