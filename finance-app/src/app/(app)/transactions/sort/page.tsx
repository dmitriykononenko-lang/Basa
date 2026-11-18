import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canWriteTx } from "@/lib/team";
import UncategorizedSorter, { type Row, type Cat } from "@/components/UncategorizedSorter";

export default async function SortPage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Разнести по статьям</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }
  const { team, role } = current;
  if (!canWriteTx(role)) {
    return (
      <div className="p-6 sm:p-8">
        <Link href="/transactions" className="text-sm text-slate-400 hover:text-brand">← Операции</Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Разнести по статьям</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Недостаточно прав.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: txs }, { data: categories }] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, type, amount, currency, occurred_on, note, account:accounts(name)")
      .eq("team_id", team.id)
      .eq("status", "actual")
      .is("category_id", null)
      .in("type", ["income", "expense"])
      .order("occurred_on", { ascending: false })
      .limit(5000),
    supabase
      .from("categories")
      .select("id, name, kind")
      .eq("team_id", team.id)
      .eq("archived", false)
      .order("name"),
  ]);

  const rows = (txs ?? []) as unknown as Row[];
  const cats = (categories ?? []) as Cat[];

  return (
    <div className="p-6 sm:p-8">
      <Link href="/transactions/import" className="text-sm text-slate-400 hover:text-brand">← Импорт</Link>
      <header className="mb-6 mt-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Разнести по статьям</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">
          Операции без статьи сгруппированы по контрагенту — выберите статью сразу для всей группы.
        </p>
      </header>

      <UncategorizedSorter rows={rows} categories={cats} />
    </div>
  );
}
