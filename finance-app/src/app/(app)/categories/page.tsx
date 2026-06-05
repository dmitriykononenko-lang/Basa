import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import AddCategoryForm from "@/components/AddCategoryForm";
import ArchiveCategoryButton from "@/components/ArchiveCategoryButton";

type Cat = {
  id: string;
  name: string;
  kind: "income" | "expense";
  parent_id: string | null;
  archived: boolean;
};

export default async function CategoriesPage() {
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
    .select("id, name, kind, parent_id, archived")
    .eq("team_id", team.id)
    .order("name");

  const all = (data ?? []) as Cat[];
  const active = all.filter((c) => !c.archived);

  function tree(kind: "income" | "expense") {
    const items = active.filter((c) => c.kind === kind);
    const roots = items.filter((c) => !c.parent_id);
    const childrenOf = (id: string) => items.filter((c) => c.parent_id === id);
    return { roots, childrenOf };
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
            Статьи доходов и расходов для классификации операций
          </p>
        </div>
        {manage && (
          <AddCategoryForm
            teamId={team.id}
            categories={active.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
          />
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CategoryColumn title="Расходы" kind="expense" tree={tree("expense")} manage={manage} />
        <CategoryColumn title="Доходы" kind="income" tree={tree("income")} manage={manage} />
      </div>
    </div>
  );
}

function CategoryColumn({
  title,
  tree,
  manage,
}: {
  title: string;
  kind: "income" | "expense";
  tree: { roots: Cat[]; childrenOf: (id: string) => Cat[] };
  manage: boolean;
}) {
  return (
    <section className="rounded-3xl bg-white ring-1 ring-slate-200/80 dark:bg-neutral-900 dark:ring-neutral-800">
      <h2 className="border-b border-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:border-neutral-800 dark:text-neutral-500">
        {title}
      </h2>
      {tree.roots.length > 0 ? (
        <ul className="divide-y divide-slate-50 dark:divide-neutral-800/60">
          {tree.roots.map((c) => (
            <li key={c.id}>
              <Row c={c} manage={manage} />
              {tree.childrenOf(c.id).map((ch) => (
                <Row key={ch.id} c={ch} manage={manage} child />
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

function Row({ c, manage, child }: { c: Cat; manage: boolean; child?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between px-5 py-2.5 ${
        child ? "pl-10" : ""
      }`}
    >
      <span className="text-sm text-slate-700 dark:text-neutral-300">
        {child && <span className="mr-2 text-slate-300">└</span>}
        {c.name}
      </span>
      {manage && <ArchiveCategoryButton categoryId={c.id} archived={c.archived} />}
    </div>
  );
}
