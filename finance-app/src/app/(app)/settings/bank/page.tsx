import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import BankConnection from "@/components/BankConnection";

export default async function BankPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Банк · Точка</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { team, role } = current;
  const supabase = await createClient();

  const [{ data: conn }, { data: accounts }, { data: categories }, { data: links }] = await Promise.all([
    supabase
      .from("bank_connections")
      .select("token_cipher, api_version, default_account_id, default_income_category_id, default_expense_category_id, last_synced_at")
      .eq("team_id", team.id).eq("provider", "tochka").maybeSingle(),
    supabase.from("accounts").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("categories").select("id, name, kind").eq("team_id", team.id).order("name"),
    supabase.from("bank_account_links").select("external_account, account_id").eq("team_id", team.id).eq("provider", "tochka"),
  ]);

  return (
    <div className="p-6 sm:p-8">
      <Link href="/settings" className="text-sm text-slate-400 hover:text-brand">← Настройки</Link>
      <header className="mb-6 mt-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Банк · Точка</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Импорт операций из Точки по API. Переводы между своими счетами помечаются автоматически.
        </p>
      </header>

      {canEditFinance(role) ? (
        <BankConnection
          connected={!!conn}
          apiVersion={conn?.api_version ?? "v1.0"}
          lastSyncedAt={conn?.last_synced_at ?? null}
          defaultAccountId={conn?.default_account_id ?? null}
          incomeCategoryId={conn?.default_income_category_id ?? null}
          expenseCategoryId={conn?.default_expense_category_id ?? null}
          accounts={accounts ?? []}
          incomeCategories={(categories ?? []).filter((c) => c.kind === "income")}
          expenseCategories={(categories ?? []).filter((c) => c.kind === "expense")}
          accountLinks={(links ?? []).map((l) => ({ external: l.external_account, accountId: l.account_id }))}
        />
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/70 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Управлять подключением банка может владелец, администратор или менеджер.
        </p>
      )}
    </div>
  );
}
