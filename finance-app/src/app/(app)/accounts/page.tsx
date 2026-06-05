import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { ACCOUNT_KIND_LABELS } from "@/lib/constants";
import AddAccountForm from "@/components/AddAccountForm";

export default async function AccountsPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-slate-900">Счета</h1>
        <p className="mt-4 text-sm text-slate-500">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const supabase = await createClient();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, currency, kind")
    .eq("team_id", team.id)
    .eq("archived", false)
    .order("created_at", { ascending: true });

  const { data: balances } = await supabase
    .from("account_balances")
    .select("account_id, balance")
    .eq("team_id", team.id);

  const balanceMap = new Map(
    (balances ?? []).map((b) => [b.account_id, b.balance])
  );

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Счета
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Кассы и счета команды «{team.name}»
          </p>
        </div>
        {canEditFinance(role) && <AddAccountForm teamId={team.id} />}
      </header>

      {accounts && accounts.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => {
            const balance = balanceMap.get(a.id) ?? 0;
            return (
              <div
                key={a.id}
                className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800"
              >
                <div className="text-sm font-medium text-slate-800 dark:text-neutral-200">
                  {a.name}
                </div>
                <div className="text-xs text-slate-400 dark:text-neutral-500">
                  {ACCOUNT_KIND_LABELS[a.kind] ?? a.kind} · {a.currency}
                </div>
                <div className="mt-3 text-xl font-bold text-slate-900 dark:text-white">
                  {formatMoney(balance, a.currency)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-800">
          Пока нет счетов.
          {canEditFinance(role)
            ? " Добавьте первый счёт кнопкой выше."
            : " Их может добавить владелец или менеджер."}
        </p>
      )}
    </div>
  );
}
