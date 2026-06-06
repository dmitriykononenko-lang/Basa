import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { formatMoney } from "@/lib/format";
import { ACCOUNT_KIND_LABELS } from "@/lib/constants";
import AddAccountForm from "@/components/AddAccountForm";
import EditAccountForm from "@/components/EditAccountForm";
import ArchiveAccountButton from "@/components/ArchiveAccountButton";

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

  const { data: allAccounts } = await supabase
    .from("accounts")
    .select("id, name, currency, kind, archived")
    .eq("team_id", team.id)
    .order("created_at", { ascending: true });

  const { data: balances } = await supabase
    .from("account_balances")
    .select("account_id, balance")
    .eq("team_id", team.id);

  const balanceMap = new Map(
    (balances ?? []).map((b) => [b.account_id, b.balance])
  );

  const accounts = (allAccounts ?? []).filter((a) => !a.archived);
  const archivedAccounts = (allAccounts ?? []).filter((a) => a.archived);
  const manage = canEditFinance(role);

  return (
    <div className="p-6 sm:p-8">
      <Link href="/settings" className="text-sm text-slate-400 hover:text-brand">
        ← Настройки
      </Link>
      <header className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
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

      {accounts.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => {
            const balance = balanceMap.get(a.id) ?? 0;
            return (
              <div
                key={a.id}
                className="rounded-3xl bg-white p-5 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:ring-white/[0.07]"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-800 dark:text-neutral-200">
                      {a.name}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-neutral-500">
                      {ACCOUNT_KIND_LABELS[a.kind] ?? a.kind} · {a.currency}
                    </div>
                  </div>
                  {manage && (
                    <div className="flex items-center gap-1">
                      <EditAccountForm accountId={a.id} name={a.name} kind={a.kind} />
                      <ArchiveAccountButton accountId={a.id} archived={false} />
                    </div>
                  )}
                </div>
                <div className="mt-3 text-xl font-bold text-slate-900 dark:text-white">
                  {formatMoney(balance, a.currency)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Пока нет счетов.
          {manage
            ? " Добавьте первый счёт кнопкой выше."
            : " Их может добавить владелец или менеджер."}
        </p>
      )}

      {archivedAccounts.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
            Архив
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {archivedAccounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200/80 dark:bg-[#15171c]/50 dark:ring-white/[0.07]"
              >
                <div>
                  <div className="text-sm font-medium text-slate-500 dark:text-neutral-400">
                    {a.name}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-neutral-600">
                    {formatMoney(balanceMap.get(a.id) ?? 0, a.currency)}
                  </div>
                </div>
                {manage && <ArchiveAccountButton accountId={a.id} archived={true} />}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
