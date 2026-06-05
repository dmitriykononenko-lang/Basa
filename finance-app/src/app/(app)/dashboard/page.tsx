import { createClient } from "@/lib/supabase/server";
import CreateTeamForm from "@/components/CreateTeamForm";
import { ROLE_LABELS } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { getCurrentTeam } from "@/lib/team";

export default async function DashboardPage() {
  const current = await getCurrentTeam();

  // Нет команды — показываем онбординг
  if (!current) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <CreateTeamForm />
      </div>
    );
  }

  const { team, role } = current;
  const supabase = await createClient();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, currency")
    .eq("team_id", team.id)
    .eq("archived", false)
    .order("created_at", { ascending: true });

  const { data: balances } = await supabase
    .from("account_balances")
    .select("account_id, currency, balance")
    .eq("team_id", team.id);

  const balanceMap = new Map(
    (balances ?? []).map((b) => [b.account_id, b.balance])
  );

  // Суммарно по счетам в базовой валюте (без пересчёта курса — пока валюта к валюте)
  const totalByCurrency = new Map<string, number>();
  for (const b of balances ?? []) {
    totalByCurrency.set(
      b.currency,
      (totalByCurrency.get(b.currency) ?? 0) + b.balance
    );
  }

  // Операции текущего месяца для дохода/расхода
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);

  const { data: monthTx } = await supabase
    .from("transactions")
    .select("type, amount")
    .eq("team_id", team.id)
    .gte("occurred_on", monthStartStr);

  let income = 0;
  let expense = 0;
  for (const t of monthTx ?? []) {
    if (t.type === "income") income += t.amount;
    else if (t.type === "expense") expense += t.amount;
  }

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Дашборд</h1>
        <p className="text-sm text-slate-500">
          {team.name} · ваша роль: {ROLE_LABELS[role]}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card title="Доход за месяц" accent="emerald">
          {formatMoney(income, team.base_currency)}
        </Card>
        <Card title="Расход за месяц" accent="red">
          {formatMoney(expense, team.base_currency)}
        </Card>
        <Card title="Денежный поток" accent="brand">
          {formatMoney(income - expense, team.base_currency)}
        </Card>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Деньги на счетах
        </h2>
        {accounts && accounts.length > 0 ? (
          <>
            <div className="mb-3 flex flex-wrap gap-4">
              {[...totalByCurrency.entries()].map(([cur, total]) => (
                <div
                  key={cur}
                  className="rounded-xl bg-white px-5 py-3 ring-1 ring-slate-200"
                >
                  <div className="text-xs text-slate-400">Итого {cur}</div>
                  <div className="text-lg font-semibold text-slate-900">
                    {formatMoney(total, cur)}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl bg-white p-4 ring-1 ring-slate-200"
                >
                  <div className="text-sm font-medium text-slate-800">
                    {a.name}
                  </div>
                  <div className="text-xs text-slate-400">{a.currency}</div>
                  <div className="mt-2 text-lg font-semibold text-slate-900">
                    {formatMoney(balanceMap.get(a.id) ?? 0, a.currency)}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="rounded-xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200">
            Пока нет счетов. Добавьте их в разделе «Счета», чтобы видеть балансы.
          </p>
        )}
      </section>
    </div>
  );
}

function Card({
  title,
  children,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  accent: "emerald" | "red" | "brand";
}) {
  const accentMap = {
    emerald: "text-emerald-600",
    red: "text-red-600",
    brand: "text-brand",
  };
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
      <div className="text-sm text-slate-500">{title}</div>
      <div className={`mt-2 text-2xl font-semibold ${accentMap[accent]}`}>
        {children}
      </div>
    </div>
  );
}
