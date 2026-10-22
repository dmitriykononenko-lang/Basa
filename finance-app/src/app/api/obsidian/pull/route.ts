import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bearerToken, teamByToken, htmlToMarkdown } from "@/lib/obsidian";

// Отдаёт статьи Базы знаний как markdown (для плагина Obsidian). Авторизация — Bearer-токен синка.
export async function GET(request: Request) {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Нет service-role ключа" }, { status: 500 });
  const teamId = await teamByToken(admin, bearerToken(request));
  if (!teamId) return NextResponse.json({ error: "Неверный токен" }, { status: 401 });

  const { data, error } = await admin
    .from("kb_articles")
    .select("id, title, kind, status, body, updated_at")
    .eq("team_id", teamId)
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data ?? []).map((a) => ({
    id: a.id,
    title: a.title ?? "Без названия",
    kind: a.kind,
    status: a.status,
    markdown: htmlToMarkdown(a.body),
    updated_at: a.updated_at,
  }));

  await admin.from("obsidian_connection").update({ last_synced_at: new Date().toISOString() }).eq("team_id", teamId);
  return NextResponse.json({ ok: true, count: items.length, items });
}
