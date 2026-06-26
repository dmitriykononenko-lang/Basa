import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance, canWriteTx } from "@/lib/team";
import {
  KB_KIND_LABELS,
  KB_STATUS_LABELS,
  kbStatusBadgeClass,
  type KbArticle,
} from "@/lib/kb";
import { htmlToPreviewText } from "@/lib/sanitize";
import KindIcon from "@/components/kb/KindIcon";
import KbFilters from "@/components/kb/KbFilters";
import EmptyState from "@/components/EmptyState";

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; status?: string }>;
}) {
  const { q, kind, status } = await searchParams;
  const current = await getCurrentTeam();
  if (!current) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">База знаний</h1>
        <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Сначала создайте команду на дашборде.</p>
      </div>
    );
  }

  const { team, role } = current;
  const canContribute = canWriteTx(role);
  const canManage = canEditFinance(role);
  const supabase = await createClient();

  let query = supabase
    .from("kb_articles")
    .select("id, team_id, kind, status, title, body, pass_score, created_by, created_at, updated_at")
    .eq("team_id", team.id);
  if (kind) query = query.eq("kind", kind);
  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("title", `%${q}%`);
  const { data } = await query.order("updated_at", { ascending: false });
  const articles = (data ?? []) as KbArticle[];

  // целевые отделы для карточек
  const ids = articles.map((a) => a.id);
  const [{ data: targets }, { data: deptsData }] = await Promise.all([
    ids.length
      ? supabase.from("kb_article_targets").select("article_id, department_id, position").in("article_id", ids)
      : Promise.resolve({ data: [] as { article_id: string; department_id: string | null; position: string | null }[] }),
    supabase.from("kb_departments").select("id, name").eq("team_id", team.id),
  ]);
  const deptName = new Map(((deptsData ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]));
  const chipsByArticle = new Map<string, string[]>();
  for (const t of (targets ?? []) as { article_id: string; department_id: string | null; position: string | null }[]) {
    const label = t.department_id ? deptName.get(t.department_id) : t.position;
    if (!label) continue;
    const arr = chipsByArticle.get(t.article_id) ?? [];
    if (!arr.includes(label)) arr.push(label);
    chipsByArticle.set(t.article_id, arr);
  }

  const filtered = !!(q || kind || status);

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">База знаний</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">Регламенты, статьи и чек-листы с проверкой знаний</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Link href="/knowledge-base/departments" className="btn-ghost">Отделы</Link>
          )}
          {canContribute && (
            <Link href="/knowledge-base/new" className="btn-primary">+ Создать</Link>
          )}
        </div>
      </header>

      <KbFilters />

      {articles.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {articles.map((a) => {
            const chips = chipsByArticle.get(a.id) ?? [];
            return (
              <li key={a.id}>
                <Link
                  href={`/knowledge-base/${a.id}`}
                  className="surface group flex h-full flex-col rounded-3xl p-5 transition hover:ring-brand/40"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                      <KindIcon kind={a.kind} className="h-5 w-5" />
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${kbStatusBadgeClass(a.status)}`}>
                      {KB_STATUS_LABELS[a.status]}
                    </span>
                  </div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{KB_KIND_LABELS[a.kind]}</div>
                  <h3 className="mt-0.5 font-semibold text-slate-900 transition group-hover:text-brand dark:text-white">{a.title}</h3>
                  {a.body && (
                    <p className="mt-1.5 line-clamp-2 flex-1 text-sm text-slate-500 dark:text-neutral-400">
                      {htmlToPreviewText(a.body)}
                    </p>
                  )}
                  {chips.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {chips.slice(0, 3).map((c) => (
                        <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                          {c}
                        </span>
                      ))}
                      {chips.length > 3 && <span className="text-[11px] text-slate-400">+{chips.length - 3}</span>}
                    </div>
                  )}
                  <div className="mt-3 text-[11px] text-slate-400">обновлено {fmtDate(a.updated_at)}</div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : filtered ? (
        <EmptyState icon="🔍" title="Ничего не найдено" description="Измените запрос или сбросьте фильтры." />
      ) : (
        <EmptyState
          icon="📚"
          title="Здесь пока пусто"
          description={canContribute ? "Создайте первый регламент, статью или чек-лист." : "Материалы появятся, когда их добавят."}
          ctaLabel={canContribute ? "+ Создать материал" : undefined}
          ctaHref={canContribute ? "/knowledge-base/new" : undefined}
        />
      )}
    </div>
  );
}
