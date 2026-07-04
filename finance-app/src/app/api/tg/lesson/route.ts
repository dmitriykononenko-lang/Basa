import { NextResponse } from "next/server";
import { resolveTg } from "@/lib/tg-session";
import { sanitizeRichHtml } from "@/lib/sanitize";
import { loomEmbedUrl, type Timecode } from "@/lib/kb-video";

export const dynamic = "force-dynamic";

// Содержимое одного урока (kb_article) для Mini App. Доступ — только если урок
// входит в назначенный пользователю курс (есть прогресс по этому элементу).
export async function POST(req: Request) {
  const { initData, articleId } = (await req.json().catch(() => ({}))) as { initData?: string; articleId?: string };
  const r = await resolveTg(initData ?? "");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const { admin, link } = r.ctx;
  if (!link) return NextResponse.json({ error: "not_linked" }, { status: 403 });
  if (!articleId) return NextResponse.json({ error: "missing_article" }, { status: 400 });

  const uid = link.user_id;
  // Элементы курсов, по которым у пользователя есть прогресс.
  const { data: prog } = await admin.from("academy_progress").select("item_id").eq("user_id", uid);
  const itemIds = ((prog ?? []) as { item_id: string }[]).map((p) => p.item_id);
  if (itemIds.length === 0) return NextResponse.json({ error: "not_assigned" }, { status: 403 });

  const { data: ci } = await admin
    .from("academy_course_items")
    .select("id")
    .eq("article_id", articleId)
    .in("id", itemIds)
    .limit(1);
  if (!ci || ci.length === 0) return NextResponse.json({ error: "not_assigned" }, { status: 403 });

  const { data: article } = await admin
    .from("kb_articles")
    .select("id, title, body, kind, video_url, timecodes")
    .eq("id", articleId)
    .maybeSingle();
  if (!article) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const a = article as { id: string; title: string; body: string | null; kind: string; video_url: string | null; timecodes: Timecode[] | null };

  const embed = a.video_url ? loomEmbedUrl(a.video_url) : null;

  return NextResponse.json({
    id: a.id,
    title: a.title,
    kind: a.kind,
    bodyHtml: a.body ? sanitizeRichHtml(a.body) : "",
    videoUrl: embed,
    timecodes: Array.isArray(a.timecodes) ? a.timecodes : [],
  });
}
