import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import CourseRunner, { type CourseItemView } from "@/components/academy/CourseRunner";
import { courseProgressPercent } from "@/lib/academy";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getCurrentTeam();
  if (!current) redirect("/academy");
  const { role } = current;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id ?? "";

  const { data: course } = await supabase
    .from("academy_courses")
    .select("id, title, description, status")
    .eq("id", id)
    .maybeSingle();
  if (!course) notFound();
  const c = course as { id: string; title: string; description: string; status: string };

  const { data: items } = await supabase
    .from("academy_course_items")
    .select("id, article_id, position")
    .eq("course_id", id)
    .order("position");
  const itemRows = (items ?? []) as { id: string; article_id: string; position: number }[];

  const articleIds = itemRows.map((i) => i.article_id);
  const { data: articles } = articleIds.length
    ? await supabase.from("kb_articles").select("id, title").in("id", articleIds)
    : { data: [] as { id: string; title: string }[] };
  const titleById = new Map(((articles ?? []) as { id: string; title: string }[]).map((a) => [a.id, a.title]));

  const { data: prog } = await supabase
    .from("academy_progress")
    .select("item_id, status")
    .eq("course_id", id)
    .eq("user_id", uid);
  const statusByItem = new Map(((prog ?? []) as { item_id: string; status: string }[]).map((p) => [p.item_id, p.status]));

  const views: CourseItemView[] = itemRows.map((it) => ({
    itemId: it.id,
    articleId: it.article_id,
    title: titleById.get(it.article_id) ?? "(материал недоступен)",
    done: statusByItem.get(it.id) === "done",
  }));

  const doneCount = views.filter((v) => v.done).length;
  const pct = courseProgressPercent(doneCount, views.length);

  return (
    <div className="p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <Link href="/academy" className="text-sm text-slate-400 hover:text-brand">← Академия</Link>
        {canEditFinance(role) && (
          <Link href={`/academy/${id}/edit`} className="text-sm text-slate-400 hover:text-brand">Настроить</Link>
        )}
      </div>
      <header className="mb-6 mt-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{c.title}</h1>
        {c.description && <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{c.description}</p>}
        {views.length > 0 && (
          <div className="mt-3 max-w-md">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
              <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Пройдено {doneCount} из {views.length} ({pct}%)</p>
          </div>
        )}
        {views.length > 0 && doneCount === views.length && (
          <Link href={`/academy/${id}/certificate`} className="btn-primary mt-4 inline-flex">
            🎓 Сертификат
          </Link>
        )}
      </header>

      {views.length > 0 ? (
        <CourseRunner items={views} />
      ) : (
        <p className="rounded-3xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200/80 dark:bg-[#15171c] dark:text-neutral-400 dark:ring-white/[0.07]">
          В курсе пока нет материалов.
        </p>
      )}
    </div>
  );
}
