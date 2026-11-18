// Письмо и Telegram по событиям запроса доступа (только сервер).
// In-app уведомление (колокольчик) пишет сама БД; здесь — внешние каналы.
// Без service-role ключа / Resend / бота — тихо пропускаем (колокольчик работает).
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfigured, sendEmail } from "@/lib/email";
import { botConfigured, sendTelegramMessage } from "@/lib/telegram";
import { serviceTitle, type IntakeServiceKind } from "@/lib/intake-form";

type Event = "open" | "submit";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function notifyIntakeEvent(requestId: string, event: Event, appUrl: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  if (!emailConfigured() && !botConfigured()) return;

  const { data: req } = await admin
    .from("vault_intake_requests")
    .select("id, team_id, requested_by, client_name, service_kind, service_label, user_added, fallback_used")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return;
  const r = req as {
    id: string; team_id: string; requested_by: string | null; client_name: string;
    service_kind: IntakeServiceKind; service_label: string; user_added: boolean; fallback_used: boolean;
  };

  const { data: members } = await admin
    .from("team_members")
    .select("user_id, role")
    .eq("team_id", r.team_id);
  const ids = new Set<string>();
  for (const m of (members ?? []) as { user_id: string; role: string }[]) {
    if (m.role === "owner" || m.role === "admin" || m.user_id === r.requested_by) ids.add(m.user_id);
  }
  if (ids.size === 0) return;

  const client = r.client_name || "Клиент";
  const service = serviceTitle(r.service_kind, r.service_label);
  const link = `${appUrl.replace(/\/+$/, "")}/vault?tab=intake`;
  const text =
    event === "submit"
      ? `${client} передал доступ: ${service}${r.user_added && !r.fallback_used ? " (добавил нас пользователем)" : ""}. Примите запись в Basa → Пароли → Запросы клиентам.`
      : `${client} открыл ссылку на передачу доступа: ${service}.`;

  const tasks: Promise<unknown>[] = [];

  if (botConfigured()) {
    const { data: links } = await admin
      .from("telegram_links")
      .select("user_id, telegram_user_id")
      .in("user_id", Array.from(ids));
    for (const l of (links ?? []) as { user_id: string; telegram_user_id: number }[]) {
      tasks.push(sendTelegramMessage(Number(l.telegram_user_id), `${text}\n${link}`));
    }
  }

  // Письмо — только о передаче доступа (открытие ссылки — колокольчик и Telegram).
  if (event === "submit" && emailConfigured()) {
    for (const uid of ids) {
      tasks.push(
        admin.auth.admin.getUserById(uid).then(({ data }) => {
          const to = data?.user?.email;
          if (!to) return;
          return sendEmail({
            to,
            subject: `${client}: передан доступ — ${service}`,
            html: `<p>${esc(text)}</p><p><a href="${esc(link)}">Открыть «Запросы клиентам»</a></p>
                   <p style="color:#64748b;font-size:12px">Данные доступа в письме не передаются: они зашифрованы и
                   открываются только в Basa паролем ключа команды.</p>`,
          });
        }),
      );
    }
  }

  await Promise.allSettled(tasks);
}
