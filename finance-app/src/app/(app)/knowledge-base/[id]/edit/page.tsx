import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import ArticleEditor, { type ArticleEditorData } from "@/components/kb/ArticleEditor";
import type { KbArticle, KbDepartment, KbQuestionType } from "@/lib/kb";

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getCurrentTeam();
  if (!current) redirect("/knowledge-base");
  const { team, role } = current;
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  const { data: article } = await supabase
    .from("kb_articles")
    .select("id, team_id, kind, status, title, body, pass_score, created_by, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!article) notFound();
  const a = article as KbArticle;

  // править может автор или менеджер+
  if (!(canEditFinance(role) || a.created_by === auth.user?.id)) redirect(`/knowledge-base/${id}`);

  const [{ data: depts }, { data: checklist }, { data: questions }, { data: options }, { data: targets }] =
    await Promise.all([
      supabase.from("kb_departments").select("id, team_id, name, parent_id").eq("team_id", team.id).order("name"),
      supabase.from("kb_checklist_items").select("content, position").eq("article_id", id).order("position"),
      supabase.from("kb_questions").select("id, prompt, qtype, position").eq("article_id", id).order("position"),
      supabase.from("kb_answer_options").select("question_id, content, is_correct, position").order("position"),
      supabase.from("kb_article_targets").select("department_id, position").eq("article_id", id),
    ]);

  const optsByQ = new Map<string, { content: string; is_correct: boolean }[]>();
  for (const o of (options ?? []) as { question_id: string; content: string; is_correct: boolean }[]) {
    const list = optsByQ.get(o.question_id) ?? [];
    list.push({ content: o.content, is_correct: o.is_correct });
    optsByQ.set(o.question_id, list);
  }

  const initial: ArticleEditorData = {
    id: a.id,
    kind: a.kind,
    status: a.status,
    title: a.title,
    body: a.body,
    pass_score: a.pass_score,
    checklist: ((checklist ?? []) as { content: string }[]).map((c) => ({ content: c.content })),
    questions: ((questions ?? []) as { id: string; prompt: string; qtype: KbQuestionType }[]).map((q) => ({
      prompt: q.prompt,
      qtype: q.qtype,
      options: optsByQ.get(q.id) ?? [],
    })),
    departmentIds: ((targets ?? []) as { department_id: string | null }[])
      .map((t) => t.department_id)
      .filter((x): x is string => !!x),
    positions: ((targets ?? []) as { position: string | null }[])
      .map((t) => t.position)
      .filter((x): x is string => !!x),
  };

  return (
    <div className="p-6 sm:p-8">
      <Link href={`/knowledge-base/${id}`} className="text-sm text-slate-400 hover:text-brand">
        ← К материалу
      </Link>
      <h1 className="mb-6 mt-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
        Редактирование
      </h1>
      <ArticleEditor teamId={team.id} departments={(depts ?? []) as KbDepartment[]} initial={initial} />
    </div>
  );
}
