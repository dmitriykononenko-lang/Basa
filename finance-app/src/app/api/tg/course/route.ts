import { NextResponse } from "next/server";
import { resolveTg } from "@/lib/tg-session";
import { courseProgressPercent } from "@/lib/academy";

export const dynamic = "force-dynamic";

// Содержимое курса для Mini App: список уроков с отметкой пройденного.
// Доступ только к курсам, на которые пользователь назначен (есть прогресс).
export async function POST(req: Request) {
  const { initData, courseId } = (await req.json().catch(() => ({}))) as { initData?: string; courseId?: string };
  const r = await resolveTg(initData ?? "");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const { admin, link } = r.ctx;
  if (!link) return NextResponse.json({ error: "not_linked" }, { status: 403 });
  if (!courseId) return NextResponse.json({ error: "missing_course" }, { status: 400 });

  const uid = link.user_id;
  // Прогресс пользователя по этому курсу = доказательство назначения.
  const { data: prog } = await admin
    .from("academy_progress")
    .select("item_id, status")
    .eq("course_id", courseId)
    .eq("user_id", uid);
  const progRows = (prog ?? []) as { item_id: string; status: string }[];
  if (progRows.length === 0) return NextResponse.json({ error: "not_assigned" }, { status: 403 });
  const statusByItem = new Map(progRows.map((p) => [p.item_id, p.status]));

  const { data: course } = await admin
    .from("academy_courses")
    .select("id, title, description")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const c = course as { id: string; title: string; description: string };

  const { data: items } = await admin
    .from("academy_course_items")
    .select("id, article_id, position")
    .eq("course_id", courseId)
    .order("position");
  const itemRows = (items ?? []) as { id: string; article_id: string; position: number }[];

  const articleIds = itemRows.map((i) => i.article_id);
  const { data: articles } = articleIds.length
    ? await admin.from("kb_articles").select("id, title, kind").in("id", articleIds)
    : { data: [] as { id: string; title: string; kind: string }[] };
  const artById = new Map(((articles ?? []) as { id: string; title: string; kind: string }[]).map((a) => [a.id, a]));

  const lessons = itemRows.map((it) => ({
    itemId: it.id,
    articleId: it.article_id,
    title: artById.get(it.article_id)?.title ?? "(материал недоступен)",
    kind: artById.get(it.article_id)?.kind ?? "article",
    done: statusByItem.get(it.id) === "done",
  }));
  const doneCount = lessons.filter((l) => l.done).length;

  return NextResponse.json({
    id: c.id,
    title: c.title,
    description: c.description,
    lessons,
    doneCount,
    total: lessons.length,
    pct: courseProgressPercent(doneCount, lessons.length),
  });
}
