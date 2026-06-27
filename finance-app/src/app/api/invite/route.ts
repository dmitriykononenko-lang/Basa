import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  let body: { teamId?: string; email?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const { teamId, email, role } = body;
  if (!teamId || !email) {
    return NextResponse.json({ error: "Укажите email" }, { status: 400 });
  }

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
