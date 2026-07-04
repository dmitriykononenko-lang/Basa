import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateInitData, hashLinkCode, tgDisplayName } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Привязка Telegram-аккаунта к учётке по email + одноразовому коду.
// Код заранее сгенерирован в веб-профиле (telegram_link_codes).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { initData?: string; email?: string; code?: string };
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "service_unavailable" }, { status: 503 });

  const v = validateInitData(body.initData ?? "");
  if (!v.ok) {
    const status = v.error === "bot_not_configured" ? 503 : 401;
    return NextResponse.json({ error: v.error }, { status });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const code = (body.code ?? "").trim().toUpperCase();
  if (!email || !code) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  // Находим активный код по email.
  const { data: row } = await admin
    .from("telegram_link_codes")
    .select("user_id, email, code_hash, expires_at")
    .ilike("email", email)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  const rec = row as { user_id: string; email: string; code_hash: string; expires_at: string };
  if (new Date(rec.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "code_expired" }, { status: 400 });
  }
  if (rec.code_hash !== hashLinkCode(code)) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const tgName = tgDisplayName(v.user);
  // Перепривязка: убираем прежние связи этого TG-аккаунта и этой учётки.
  await admin.from("telegram_links").delete().eq("telegram_user_id", v.user.id);
  await admin.from("telegram_links").delete().eq("user_id", rec.user_id);
  const { error: insErr } = await admin.from("telegram_links").insert({
    user_id: rec.user_id,
    telegram_user_id: v.user.id,
    telegram_username: v.user.username ?? null,
    telegram_name: tgName,
    photo_url: v.user.photo_url ?? null,
  });
  if (insErr) return NextResponse.json({ error: "link_failed" }, { status: 500 });

  // Код одноразовый — удаляем.
  await admin.from("telegram_link_codes").delete().eq("user_id", rec.user_id);

  return NextResponse.json({ ok: true, name: tgName });
}
