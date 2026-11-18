import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { resolveTg } from "@/lib/tg-session";

export const dynamic = "force-dynamic";

// Отметить элемент курса пройденным из Mini App. Обновляем только строку
// прогресса самого пользователя (academy_progress по item_id + user_id).
export async function POST(req: Request) {
  const p = await parseJson(req, z.object({ initData: z.string(), itemId: z.string().uuid() }));
  if (!p.ok) return p.res;
  const { initData, itemId } = p.data;
  const r = await resolveTg(initData);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const { admin, link } = r.ctx;
  if (!link) return NextResponse.json({ error: "not_linked" }, { status: 403 });

  const { data, error } = await admin
    .from("academy_progress")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("item_id", itemId)
    .eq("user_id", link.user_id)
    .select("item_id");

  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "not_assigned" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
