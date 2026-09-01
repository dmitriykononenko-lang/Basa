import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import { sendEmail, emailConfigured } from "@/lib/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function inviteHtml(opts: { subjectName: string; teamName: string; link: string }) {
  const { subjectName, teamName, link } = opts;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px;">
    <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#94a3b8;">Оценка Soft Skills · ${escapeHtml(teamName)}</div>
    <h1 style="font-size:22px;color:#0f172a;margin:8px 0 6px;">Здравствуйте, ${escapeHtml(subjectName)}!</h1>
    <p style="color:#475569;font-size:15px;line-height:1.5;margin:0 0 8px;">
      Вас просят пройти короткий опросник для оценки профессиональных компетенций.
      Это займёт 10–15 минут. Правильных и неправильных ответов нет — отвечайте честно.
    </p>
    <p style="margin:22px 0;">
      <a href="${link}" style="display:inline-block;background:#2f6df6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-size:15px;font-weight:600;">Пройти тест</a>
    </p>
    <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0;">
      Если кнопка не работает, откройте ссылку вручную:<br>
      <a href="${link}" style="color:#2f6df6;word-break:break-all;">${link}</a>
    </p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export async function POST(request: Request) {
  let body: { counterpartyId?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const counterpartyId = body.counterpartyId?.trim();
  const email = body.email?.trim().toLowerCase();
  if (!counterpartyId) return NextResponse.json({ error: "Не выбран сотрудник" }, { status: 400 });
  if (!email || !EMAIL_RE.test(email)) return NextResponse.json({ error: "Укажите корректный email" }, { status: 400 });

  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { team } = current;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  // Имя сотрудника (и проверка, что он в этой команде — иначе RLS не даст прочитать).
  const { data: emp } = await supabase
    .from("counterparties")
    .select("id, name, email")
    .eq("team_id", team.id)
    .eq("id", counterpartyId)
    .maybeSingle();
  if (!emp) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });

  // Создаём оценку (RLS проверит членство в команде). Токен — из default в БД.
  const { data: created, error: insErr } = await supabase
    .from("assessments")
    .insert({
      team_id: team.id,
      counterparty_id: counterpartyId,
      respondent_name: emp.name,
      method: "self",
      status: "in_progress",
      created_by: user.id,
    })
    .select("id, share_token")
    .single();
  if (insErr || !created) {
    return NextResponse.json({ error: insErr?.message ?? "Не удалось создать оценку" }, { status: 403 });
  }

  const origin = new URL(request.url).origin;
  const link = `${origin}/t/${created.share_token}`;

  // Запоминаем email сотрудника, если раньше не был указан (для следующего раза).
  if (!emp.email) {
    await supabase.from("counterparties").update({ email }).eq("id", counterpartyId).eq("team_id", team.id);
  }

  // Отправляем письмо (мягкая деградация: без ключа — вернём ссылку для ручной отправки).
  let emailed = false;
  let note: string | null = null;
  if (emailConfigured()) {
    const res = await sendEmail({
      to: email,
      subject: `Опросник для оценки · ${team.name}`,
      html: inviteHtml({ subjectName: emp.name, teamName: team.name, link }),
    });
    emailed = res.ok;
    if (!res.ok) note = res.error ?? res.skipped ?? "Не удалось отправить письмо";
  } else {
    note = "Почта не настроена — отправьте ссылку вручную";
  }

  return NextResponse.json({ ok: true, emailed, note, link, assessmentId: created.id });
}
