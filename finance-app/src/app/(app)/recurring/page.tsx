import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import RecurringManager, { type RecurringRule } from "@/components/RecurringManager";

export default async function RecurringPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Регулярные операции</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }

  const { team, role } = current;
  if (!canEditFinance(role)) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Регулярные операции</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Недостаточно прав.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: rules }, { data: accounts }, { data: categories }, { data: counterparties }, { data: projects }] = await Promise.all([
    supabase.from("recurring_rules").select("id, type, amount, currency, account_id, transfer_account_id, category_id, counterparty_id, project_id, note, frequency, day_of_month, weekday, start_date, end_date, active").eq("team_id", team.id).order("created_at", { ascending: false }),
    supabase.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false).order("created_at"),
    supabase.from("categories").select("id, name, kind").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("counterparties").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("projects").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
  ]);

  return (
    <div className="p-6 sm:p-8">
      <Link href="/transactions" className="text-sm text-slate-400 hover:text-brand">← Операции</Link>
      <header className="mb-6 mt-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Регулярные операции</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Шаблоны (аренда, оклад, подписки) автоматически создают плановые операции —
          они попадают в платёжный календарь и прогноз кассового разрыва.
        </p>
      </header>

      {user && (
        <RecurringManager
          teamId={team.id}
          userId={user.id}
          rules={(rules ?? []) as RecurringRule[]}
          accounts={accounts ?? []}
          categories={(categories ?? []) as { id: string; name: string; kind: "income" | "expense" }[]}
          counterparties={counterparties ?? []}
          projects={projects ?? []}
        />
      )}
    </div>
  );
}
