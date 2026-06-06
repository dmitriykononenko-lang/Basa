import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canWriteTx } from "@/lib/team";
import ImportWizard from "@/components/ImportWizard";
import ImportBatchCard, { type Batch } from "@/components/ImportBatchCard";

export default async function ImportPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Импорт выписки</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }

  const { team, role } = current;
  if (!canWriteTx(role)) {
    return (
      <div className="p-6 sm:p-8">
        <Link href="/transactions" className="text-sm text-slate-400 hover:text-brand">← Операции</Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Импорт выписки</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Недостаточно прав для импорта операций.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: accounts }, { data: categories }, { data: counterparties }, { data: projects }, { data: batches }] = await Promise.all([
    supabase.from("accounts").select("id, name, currency").eq("team_id", team.id).eq("archived", false).order("created_at"),
    supabase.from("categories").select("id, name, kind").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("counterparties").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("projects").select("id, name").eq("team_id", team.id).eq("archived", false).order("name"),
    supabase.from("import_batches").select("id, file_name, created_at, row_count, status, bank, account:accounts(name)").eq("team_id", team.id).order("created_at", { ascending: false }).limit(50),
  ]);

  const cats = (categories ?? []) as { id: string; name: string; kind: "income" | "expense" }[];
  const batchList = (batches ?? []) as unknown as Batch[];

  return (
    <div className="p-6 sm:p-8">
      <Link href="/transactions" className="text-sm text-slate-400 hover:text-brand">← Операции</Link>
      <header className="mb-6 mt-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Импорт выписки</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Каждая загрузка — отдельный импорт; его можно отменить целиком.
        </p>
      </header>

      <div className="mb-6">
        {user && (
          <ImportWizard
            teamId={team.id}
            userId={user.id}
            accounts={accounts ?? []}
            categories={cats}
            counterparties={counterparties ?? []}
            projects={projects ?? []}
          />
        )}
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
        История импортов
      </h2>
      {batchList.length > 0 ? (
        <div className="space-y-2">
          {batchList.map((b) => <ImportBatchCard key={b.id} batch={b} />)}
        </div>
      ) : (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Импортов пока нет.
        </p>
      )}
    </div>
  );
}
