import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import RulesManager, { type Rule } from "@/components/RulesManager";

export default async function RulesSettingsPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Правила автоматизации</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { team, role } = current;
  const supabase = await createClient();

  const [{ data: rules }, { data: counterparties }, { data: categories }, { data: projects }, { data: accounts }] = await Promise.all([
    supabase.from("automation_rules").select("id, enabled, conditions, action").eq("team_id", team.id).order("created_at", { ascending: false }),
    supabase.from("counterparties").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("categories").select("id, name, kind").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("projects").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("accounts").select("id, name").eq("team_id", team.id).eq("archived", false).order("created_at"),
  ]);

  return (
    <div className="p-6 sm:p-8">
      <Link href="/settings" className="text-sm text-slate-400 hover:text-brand">← Настройки</Link>
      <header className="mb-6 mt-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Правила автоматизации</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Если выполняются все условия — автоматически проставить статью, проект или сделать операцию переводом
        </p>
      </header>

      <RulesManager
        rules={(rules ?? []) as Rule[]}
        counterparties={(counterparties ?? []) as { id: string; name: string }[]}
        categories={(categories ?? []) as { id: string; name: string; kind: "income" | "expense" }[]}
        projects={(projects ?? []) as { id: string; name: string }[]}
        accounts={(accounts ?? []) as { id: string; name: string }[]}
        teamId={team.id}
        canEdit={canEditFinance(role)}
      />
    </div>
  );
}
