import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import AddCategoryForm from "@/components/AddCategoryForm";
import CategoryEditor, { type CategoryData } from "@/components/CategoryEditor";

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Статьи
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const manage = canEditFinance(role);
  const supabase = await createClient();

  const { data } = await supabase
    .from("categories")
    .select("id, name, kind, parent_id, note, cf_activity, pnl_treatment, archived")
    .eq("team_id", team.id)
    .order("name");

  const all = (data ?? []) as CategoryData[];
  const visible = all.filter((c) => (showArchived ? true : !c.archived));

  function group(kind: "income" | "expense") {
    const items = visible.filter((c) => c.kind === kind);
    const roots = items.filter((c) => !c.parent_id);
    const childrenOf = (id: string) => items.filter((c) => c.parent_id === id);
    const parentOptions = all
      .filter((c) => c.kind === kind && !c.parent_id && !c.archived)
      .map((c) => ({ id: c.id, name: c.name }));
    return { roots, childrenOf, parentOptions };
  }

  return (
    <div className="p-6 sm:p-8">
      <Link href="/settings" className="text-sm text-slate-400 hover:text-brand">
        ← Настройки
      </Link>
      <header className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Статьи
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Статьи доходов и расходов: вид деятельности (ДДС) и правило учёта (ОПиУ)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={showArchived ? "/categories" : "/categories?archived=1"}
            className="text-sm text-slate-400 hover:text-brand"
          >
            {showArchived ? "Скрыть архив" : "Показать архив"}
          </Link>
          {manage && (
            <AddCategoryForm
              teamId={team.id}
              categories={all.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
            />
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Column title="Статьи расходов" data={group("expense")} manage={manage} />
        <Column title="Статьи доходов" data={group("income")} manage={manage} />
      </div>
    </div>
  );
}

function Column({
  title,
  data,
  manage,
}: {
  title: string;
  data: {
    roots: CategoryData[];
    childrenOf: (id: string) => CategoryData[];
    parentOptions: { id: string; name: string }[];
  };
  manage: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800">
      <h2 className="border-b border-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:border-neutral-800 dark:text-neutral-500">
        {title}
      </h2>
      {data.roots.length > 0 ? (
        <ul className="divide-y divide-slate-50 dark:divide-neutral-800/60">
          {data.roots.map((c) => (
            <li key={c.id}>
              <CategoryEditor
                category={c}
                parents={data.parentOptions.filter((p) => p.id !== c.id)}
                manage={manage}
              />
              {data.childrenOf(c.id).map((ch) => (
                <CategoryEditor
                  key={ch.id}
                  category={ch}
                  parents={data.parentOptions.filter((p) => p.id !== ch.id)}
                  manage={manage}
                  child
                />
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-slate-400">Нет статей.</p>
      )}
    </section>
  );
}
