import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const p = await parseJson(
    request,
    z.object({
      teamId: z.string().uuid(),
      email: z.string().email(),
      role: z.enum(["admin", "manager", "employee", "viewer"]).optional(),
      counterpartyId: z.string().uuid().optional(),
    }),
  );
  if (!p.ok) return p.res;
  const { teamId, email, role, counterpartyId } = p.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Создаём приглашение — RLS проверит, что вызывающий владелец/админ команды
  const { data: inv, error } = await supabase
    .from("invites")
    .insert({
      team_id: teamId,
      email: email.trim().toLowerCase(),
      role: role || "employee",
      invited_by: user.id,
      counterparty_id: counterpartyId ?? null,
    })
    .select("id")
    .single();

  if (error || !inv) {
    return NextResponse.json(
      { error: error?.message ?? "Не удалось создать приглашение" },
      { status: 403 }
    );
  }

  const origin = new URL(request.url).origin;
  const link = `${origin}/join?invite=${inv.id}`;

  // Пытаемся отправить письмо через Supabase (если задан service_role)
  let emailed = false;
  let emailNote: string | null = null;
  const admin = createAdminClient();
  if (admin) {
    const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(
      email.trim().toLowerCase(),
      { redirectTo: link }
    );
    if (mailErr) {
      emailNote = mailErr.message;
    } else {
      emailed = true;
    }
  } else {
    emailNote = "Почтовый ключ не настроен — используйте ссылку";
  }

  return NextResponse.json({ ok: true, emailed, emailNote, link, inviteId: inv.id });
}
