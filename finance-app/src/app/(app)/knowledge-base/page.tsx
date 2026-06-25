import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance, canWriteTx } from "@/lib/team";
import {
  KB_KIND_LABELS,
  KB_STATUS_LABELS,
  kbStatusBadgeClass,
  type KbArticle,
} from "@/lib/kb";

export default async function KnowledgeBasePage() {
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          База знаний
        </h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
          Сначала создайте команду на дашборде.
        </p>
      </div>
    );
  }

  const { team, role } = current;
  const canContribute = canWriteTx(role);
  const canManage = canEditFinance(role);
  const supabase = await createClient();

  const { data } = await supabase
    .from("kb_articles")
    .select("id, team_id, kind, status, title, body, pass_score, created_by, created_at, updated_at")
    .eq("team_id", team.id)
    .order("updated_at", { ascending: false });

  const articles = (data ?? []) as KbArticle[];

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            База знаний
          </h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            Регламенты, статьи и чек-листы с проверочными вопросами
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canManage && (
            <Link href="/knowledge-base/departments" className="text-sm text-slate-400 hover:text-brand">
              Отделы
            </Link>
          )}
          {canContribute && (
            <Link href="/knowledge-base/new" className="btn-primary">
              + Создать
            </Link>
          )}
        </div>
      </header>

      {articles.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {articles.map((a) => (
            <li key={a.id}>
              <Link
                href={`/knowledge-base/${a.id}`}
                className="surface block h-full rounded-3xl p-5 transition hover:ring-brand/40"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
                    {KB_KIND_LABELS[a.kind]}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${kbStatusBadgeClass(a.status)}`}>
                    {KB_STATUS_LABELS[a.status]}
                  </span>
                </div>
                <h3 className="font-semibold text-slate-900 dark:text-white">{a.title}</h3>
                {a.body && (
                  <p className="mt-1.5 line-clamp-2 text-sm text-slate-500 dark:text-neutral-400">
                    {a.body}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          Пока нет материалов.{canContribute && " Создайте первый регламент или статью."}
        </p>
      )}
    </div>
  );
}
