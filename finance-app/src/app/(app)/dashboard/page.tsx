import { createClient } from "@/lib/supabase/server";
import CreateTeamForm from "@/components/CreateTeamForm";
import { ROLE_LABELS, type AppRole } from "@/lib/types";
import { formatMoney } from "@/lib/format";

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("team_members")
    .select("role, teams(id, name, base_currency)")
    .order("created_at", { ascending: true });

  // Нет команды — показываем онбординг
  if (!memberships || memberships.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <CreateTeamForm />
      </div>
    );
  }

  const current = memberships[0] as unknown as {
    role: AppRole;
    teams: { id: string; name: string; base_currency: string };
  };
  const team = current.teams;

  // Сводка по балансам счетов
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, currency")
    .eq("team_id", team.id)
    .eq("archived", false);

  // Операции текущего месяца для дохода/расхода
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);

  const { data: monthTx } = await supabase
    .from("transactions")
    .select("type, amount, currency")
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
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Дашборд</h1>
          <p className="text-sm text-slate-500">
            {team.name} · ваша роль: {ROLE_LABELS[current.role]}
          </p>
        </div>
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
          Счета
        </h2>
        {accounts && accounts.length > 0 ? (
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
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200">
            Пока нет счетов. Скоро здесь появится возможность их добавить, и мы
            покажем балансы.
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
