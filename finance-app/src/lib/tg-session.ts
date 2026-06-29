// Хелпер для TG-роутов: проверяет initData, находит привязку и команду.
// Возвращает admin-клиент (service_role) — в Telegram нет supabase-сессии,
// поэтому доступ к данным идёт под service_role с ручной проверкой прав.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateInitData, type TgUser } from "@/lib/telegram";

export type TgLink = {
  user_id: string;
  telegram_user_id: number;
  telegram_username: string | null;
  telegram_name: string | null;
};

export type TgContext = {
  admin: SupabaseClient;
  tgUser: TgUser;
  link: TgLink | null;
};

export type TgResolve = { ok: true; ctx: TgContext } | { ok: false; status: number; error: string };

// Проверяет подпись и возвращает контекст. Привязка (link) может быть null —
// тогда нужен экран привязки.
export async function resolveTg(initData: string): Promise<TgResolve> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, status: 503, error: "service_unavailable" };

  const v = validateInitData(initData);
  if (!v.ok) {
    const status = v.error === "bot_not_configured" ? 503 : 401;
    return { ok: false, status, error: v.error };
  }

  const { data } = await admin
    .from("telegram_links")
    .select("user_id, telegram_user_id, telegram_username, telegram_name")
    .eq("telegram_user_id", v.user.id)
    .maybeSingle();

  return { ok: true, ctx: { admin, tgUser: v.user, link: (data as TgLink | null) ?? null } };
}

// Команда пользователя (первая по дате вступления) — как getCurrentTeam, но под admin.
export async function tgUserTeam(
  admin: SupabaseClient,
  userId: string,
): Promise<{ id: string; name: string } | null> {
  const { data } = await admin
    .from("team_members")
    .select("team_id, created_at, teams(id, name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const row = data as unknown as { teams: { id: string; name: string } | null } | null;
  return row?.teams ?? null;
}
