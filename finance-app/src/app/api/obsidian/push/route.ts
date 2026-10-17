import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bearerToken, teamByToken, markdownToHtml } from "@/lib/obsidian";

type PushItem = { id?: string; title?: string; markdown?: string; base_updated_at?: string };

// Принимает статьи из Obsidian (markdown → HTML). Конфликты: last-write-wins по updated_at.
export async function POST(request: Request) {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Нет service-role ключа" }, { status: 500 });
  const teamId = await teamByToken(admin, bearerToken(request));
  if (!teamId) return NextResponse.json({ error: "Неверный токен" }, { status: 401 });

  let body: { items?: PushItem[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 }); }
  const items = Array.isArray(body.items) ? body.items : [];

  const results: { title: string; id?: string; status: "created" | "updated" | "conflict" | "error"; error?: string }[] = [];

  for (const it of items) {
    const title = (it.title ?? "").trim() || "Без названия";
    const html = markdownToHtml(it.markdown ?? "");
    try {
      if (it.id) {
        const { data: existing } = await admin
          .from("kb_articles").select("id, updated_at").eq("id", it.id).eq("team_id", teamId).maybeSingle();
        if (!existing) { results.push({ title, status: "error", error: "статья не найдена" }); continue; }
        // Конфликт: сервер новее базовой версии клиента — не перезаписываем.
        if (it.base_updated_at && new Date(existing.updated_at) > new Date(it.base_updated_at)) {
          results.push({ title, id: it.id, status: "conflict" }); continue;
        }
        const { error } = await admin.from("kb_articles")
          .update({ title, body: html, updated_at: new Date().toISOString() })
          .eq("id", it.id).eq("team_id", teamId);
        if (error) { results.push({ title, id: it.id, status: "error", error: error.message }); continue; }
        results.push({ title, id: it.id, status: "updated" });
      } else {
        const { data: ins, error } = await admin.from("kb_articles")
          .insert({ team_id: teamId, kind: "article", status: "draft", title, body: html })
          .select("id").single();
        if (error) { results.push({ title, status: "error", error: error.message }); continue; }
        results.push({ title, id: ins.id, status: "created" });
      }
    } catch (e) {
      results.push({ title, status: "error", error: e instanceof Error ? e.message : "Ошибка" });
    }
  }

  await admin.from("obsidian_connection").update({ last_synced_at: new Date().toISOString() }).eq("team_id", teamId);
  const conflicts = results.filter((r) => r.status === "conflict").length;
  return NextResponse.json({ ok: true, results, conflicts });
}
