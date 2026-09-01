import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import AddAccountForm from "@/components/AddAccountForm";
import AccountsList from "@/components/AccountsList";
import { type AccountFull } from "@/components/AccountCard";
import { buildRateMap } from "@/lib/fx";

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
    .select("id, name, currency, kind, archived, number, bank_name, bik, corr_account, legal_entity, account_group, opening_balance, opening_date")
    .eq("team_id", team.id)
    .order("created_at", { ascending: true });

  const [{ data: balances }, { data: fxRows }] = await Promise.all([
    supabase.from("account_balances").select("account_id, balance").eq("team_id", team.id),
    supabase.from("fx_rates").select("currency, rate, rate_date").eq("team_id", team.id),
  ]);

  const balanceMap: Record<string, number> = {};
  for (const b of balances ?? []) balanceMap[b.account_id] = b.balance;

  const accounts = (allAccounts ?? []) as AccountFull[];
  const rates = buildRateMap(fxRows ?? [], team.base_currency);

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
            Кассы и счета команды «{team.name}» · сгруппированы по юр. лицу
          </p>
        </div>
        {canEditFinance(role) && <AddAccountForm teamId={team.id} />}
      </header>

      <AccountsList accounts={accounts} balances={balanceMap} canEdit={canEditFinance(role)} base={team.base_currency} rates={rates} />
    </div>
  );
}
