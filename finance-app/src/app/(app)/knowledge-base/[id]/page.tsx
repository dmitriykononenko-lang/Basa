import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import QuizRunner from "@/components/kb/QuizRunner";
import { sanitizeRichHtml } from "@/lib/sanitize";
import {
  KB_KIND_LABELS,
  KB_STATUS_LABELS,
  kbStatusBadgeClass,
  type KbArticle,
} from "@/lib/kb";

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getCurrentTeam();
  if (!current) redirect("/knowledge-base");
  const { role } = current;
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const { data: article } = await supabase
    .from("kb_articles")
    .select("id, team_id, kind, status, title, body, pass_score, created_by, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!article) notFound();
  const a = article as KbArticle;

  const canEdit = canEditFinance(role) || a.created_by === auth.user?.id;

  const [{ data: checklist }, { data: lastAttempt }] = await Promise.all([
    supabase.from("kb_checklist_items").select("content, position").eq("article_id", id).order("position"),
    supabase
      .from("kb_quiz_attempts")
      .select("score, passed, finished_at")
      .eq("article_id", id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return (
    <div className="p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <Link href="/knowledge-base" className="text-sm text-slate-400 hover:text-brand">
          ← База знаний
        </Link>
        {canEdit && (
          <Link href={`/knowledge-base/${id}/edit`} className="text-sm text-slate-400 hover:text-brand">
            Редактировать
          </Link>
        )}
      </div>

      <header className="mb-6 mt-2">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
            {KB_KIND_LABELS[a.kind]}
          </span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${kbStatusBadgeClass(a.status)}`}>
            {KB_STATUS_LABELS[a.status]}
          </span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{a.title}</h1>
      </header>

      {a.body && (
        <article
          className="surface kb-content rounded-3xl p-6 text-sm leading-relaxed text-slate-700 dark:text-neutral-300"
          dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(a.body) }}
        />
      )}

      {(checklist ?? []).length > 0 && (
        <section className="surface mt-4 rounded-3xl p-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Чек-лист</h2>
          <ul className="space-y-2">
            {((checklist ?? []) as { content: string }[]).map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-neutral-300">
                <span className="mt-1 inline-block h-4 w-4 shrink-0 rounded border border-slate-300 dark:border-white/20" />
                <div className="kb-content flex-1" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(c.content) }} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <QuizRunner
        articleId={a.id}
        passScore={a.pass_score}
        lastAttempt={(lastAttempt as { score: number; passed: boolean; finished_at: string | null } | null) ?? null}
      />
    </div>
  );
}
