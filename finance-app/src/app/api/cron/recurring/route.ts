import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Повторное обучение: находит назначения с периодичностью, у которых пора начать новый
// цикл (today >= last_issued_on + recur_months), и пере-выдаёт курс через academy_reissue
// (сброс прогресса + новый срок). Уведомления «пройти заново» прилетят крон-механизмом
// уведомлений (training_due) после сброса прогресса. Защита/«рубильник» — CRON_SECRET.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: true, skipped: "CRON_SECRET не задан — повторное обучение в этом проекте выключено" });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Нет service-role ключа" }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: rows, error } = await admin
    .from("academy_assignments")
    .select("id, recur_months, last_issued_on")
    .gt("recur_months", 0);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let reissued = 0;
  const errors: Array<Record<string, unknown>> = [];
  for (const a of (rows ?? []) as { id: string; recur_months: number; last_issued_on: string | null }[]) {
    if (!a.last_issued_on) continue;
    if (addMonths(a.last_issued_on, a.recur_months) > today) continue; // ещё не пора
    const { error: e } = await admin.rpc("academy_reissue", { _assignment_id: a.id });
    if (e) errors.push({ id: a.id, error: e.message });
    else reissued += 1;
  }

  return NextResponse.json({ ok: true, today, checked: (rows ?? []).length, reissued, errors });
}

function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}
