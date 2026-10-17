// Отправка email через Resend (REST API, без доп. зависимостей).
// Мягкая деградация: без RESEND_API_KEY/EMAIL_FROM письма не шлются (как vault без ключа) —
// in-app уведомления при этом работают. Только серверный код.

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

type SendArgs = { to: string; subject: string; html: string };
type SendResult = { ok: boolean; skipped?: string; error?: string };

export async function sendEmail({ to, subject, html }: SendArgs): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { ok: false, skipped: "email не настроен (нет RESEND_API_KEY/EMAIL_FROM)" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Ошибка отправки" };
  }
}

// HTML письма-дайджеста из списка алертов получателя.
const SEVERITY_COLOR: Record<string, string> = {
  critical: "#dc2626",
  warning: "#d97706",
  info: "#2563eb",
};

export function digestHtml(opts: {
  teamName: string;
  appUrl: string;
  items: { severity: string; title: string; body: string; link: string }[];
}): string {
  const { teamName, appUrl, items } = opts;
  const rows = items
    .map((a) => {
      const color = SEVERITY_COLOR[a.severity] ?? "#64748b";
      const href = a.link ? `${appUrl}${a.link}` : appUrl;
      return `
        <tr><td style="padding:12px 0;border-bottom:1px solid #eef2f7;">
          <div style="display:flex;align-items:flex-start;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${color};margin:6px 10px 0 0;"></span>
            <div>
              <a href="${href}" style="color:#0f172a;font-weight:600;text-decoration:none;font-size:15px;">${escapeHtml(a.title)}</a>
              ${a.body ? `<div style="color:#64748b;font-size:13px;margin-top:2px;">${escapeHtml(a.body)}</div>` : ""}
            </div>
          </div>
        </td></tr>`;
    })
    .join("");
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="font-size:18px;color:#0f172a;margin:0 0 4px;">Сводка по «${escapeHtml(teamName)}»</h1>
    <p style="color:#64748b;font-size:13px;margin:0 0 16px;">Что требует внимания сегодня:</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
    <p style="margin-top:20px;">
      <a href="${appUrl}/dashboard" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600;">Открыть приложение</a>
    </p>
    <p style="color:#94a3b8;font-size:12px;margin-top:20px;">Отключить эти письма можно в профиле → настройки уведомлений.</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
