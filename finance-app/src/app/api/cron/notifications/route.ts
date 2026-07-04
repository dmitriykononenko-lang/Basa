import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeTeamAlerts, type TeamAlert } from "@/lib/alerts";
import { emailConfigured, sendEmail, digestHtml } from "@/lib/email";

// Пересчёт уведомлений по командам (Vercel Cron).
//   ?mode=refresh — только in-app (колокольчик). По умолчанию.
//   ?mode=digest  — in-app + email-дайджест получателям с включённой рассылкой.
// Защита/«рубильник» — CRON_SECRET (как в tochka/cron): работает только там, где он задан.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type DesiredRow = {
  team_id: string;
  user_id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  link: string;
  dedupe_key: string;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: true, skipped: "CRON_SECRET не задан — уведомления в этом проекте выключены" });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Нет service-role ключа" }, { status: 500 });
  }

  const mode = new URL(request.url).searchParams.get("mode") === "digest" ? "digest" : "refresh";
  const appUrl = new URL(request.url).origin;
  const today = new Date().toISOString().slice(0, 10);

  const { data: teams, error: teamErr } = await admin
    .from("teams")
    .select("id, name, base_currency");
  if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });

  const summary: Array<Record<string, unknown>> = [];

  for (const team of (teams ?? []) as { id: string; name: string; base_currency: string }[]) {
    try {
      const alerts = await computeTeamAlerts(admin, team, today);

      // Разворачиваем алерты в желаемые строки notifications (по получателям).
      const desired = new Map<string, DesiredRow>(); // ключ: `${user_id}::${dedupe_key}`
      const byUser = new Map<string, TeamAlert[]>(); // для дайджеста
      for (const a of alerts) {
        for (const uid of a.recipients) {
          const key = `${uid}::${a.dedupeKey}`;
          if (desired.has(key)) continue;
          desired.set(key, {
            team_id: team.id, user_id: uid, type: a.type, severity: a.severity,
            title: a.title, body: a.body, link: a.link, dedupe_key: a.dedupeKey,
          });
          const arr = byUser.get(uid) ?? [];
          arr.push(a);
          byUser.set(uid, arr);
        }
      }

      // Текущие строки команды.
      const { data: existing } = await admin
        .from("notifications")
        .select("id, user_id, dedupe_key, title, body, severity, link, read_at")
        .eq("team_id", team.id);
      const existingByKey = new Map<string, { id: string; title: string; body: string; severity: string; link: string }>();
      for (const r of (existing ?? []) as { id: string; user_id: string; dedupe_key: string; title: string; body: string; severity: string; link: string; read_at: string | null }[]) {
        existingByKey.set(`${r.user_id}::${r.dedupe_key}`, r);
      }

      const toInsert: DesiredRow[] = [];
      let updated = 0;
      for (const [key, row] of desired) {
        const prev = existingByKey.get(key);
        if (!prev) {
          toInsert.push(row);
        } else if (prev.title !== row.title || prev.body !== row.body || prev.severity !== row.severity || prev.link !== row.link) {
          // содержимое изменилось → обновляем и заново помечаем непрочитанным
          await admin.from("notifications")
            .update({ title: row.title, body: row.body, severity: row.severity, link: row.link, type: row.type, read_at: null })
            .eq("id", prev.id);
          updated++;
        }
      }
      if (toInsert.length) await admin.from("notifications").insert(toInsert);

      // Протухшие непрочитанные авто-уведомления (условие исчезло) — удаляем.
      const staleIds: string[] = [];
      for (const r of (existing ?? []) as { id: string; user_id: string; dedupe_key: string; read_at: string | null }[]) {
        if (r.read_at) continue; // прочитанные оставляем как историю
        if (!desired.has(`${r.user_id}::${r.dedupe_key}`)) staleIds.push(r.id);
      }
      if (staleIds.length) await admin.from("notifications").delete().in("id", staleIds);

      // ── Email-дайджест ──
      let emailed = 0;
      if (mode === "digest" && emailConfigured() && byUser.size > 0) {
        const uids = [...byUser.keys()];
        const { data: prefs } = await admin
          .from("notification_prefs")
          .select("user_id, email_digest")
          .eq("team_id", team.id)
          .in("user_id", uids);
        const digestOff = new Set(
          ((prefs ?? []) as { user_id: string; email_digest: boolean }[])
            .filter((p) => p.email_digest === false)
            .map((p) => p.user_id),
        );
        for (const uid of uids) {
          if (digestOff.has(uid)) continue; // отписан (нет строки = включено)
          const items = byUser.get(uid)!;
          if (!items.length) continue;
          const { data: u } = await admin.auth.admin.getUserById(uid);
          const to = u?.user?.email;
          if (!to) continue;
          const res = await sendEmail({
            to,
            subject: `Сводка по «${team.name}» — ${items.length} ${plural(items.length)}`,
            html: digestHtml({ teamName: team.name, appUrl, items }),
          });
          if (res.ok) emailed++;
        }
      }

      summary.push({ team: team.id, alerts: alerts.length, inserted: toInsert.length, updated, deleted: staleIds.length, emailed });
    } catch (e) {
      summary.push({ team: team.id, error: e instanceof Error ? e.message : "Ошибка" });
    }
  }

  return NextResponse.json({ ok: true, mode, today, teams: summary.length, summary });
}

function plural(n: number): string {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return "уведомление";
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return "уведомления";
  return "уведомлений";
}
