import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { decryptSecret } from "@/lib/crypto";
import { getAccounts } from "@/lib/tochka";
import { importTochkaStatement } from "@/lib/tochka-import";

// Фоновая авто-синхронизация Точки «при открытии приложения» — чтобы не нажимать
// кнопки. Работает под сессией пользователя (не требует CRON_SECRET/крона Vercel).
// Тротлинг: не чаще раза в FRESH_MINUTES; окно — последние WINDOW_DAYS дней (дедуп).
export const maxDuration = 300;
const FRESH_MINUTES = 120;
const WINDOW_DAYS = 10;

export async function POST() {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ ok: true, skipped: "no_team" });
  if (!canEditFinance(current.role)) return NextResponse.json({ ok: true, skipped: "no_access" });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: true, skipped: "no_auth" });
  const teamId = current.team.id;

  const { data: conn } = await supabase
    .from("bank_connections")
    .select("token_cipher, api_version, default_account_id, default_income_category_id, default_expense_category_id, last_synced_at")
    .eq("team_id", teamId).eq("provider", "tochka").maybeSingle();
  if (!conn) return NextResponse.json({ ok: true, skipped: "not_connected" });

  // Свежо — ничего не делаем.
  if (conn.last_synced_at) {
    const ageMin = (Date.now() - Date.parse(conn.last_synced_at)) / 60000;
    if (ageMin < FRESH_MINUTES) return NextResponse.json({ ok: true, skipped: "fresh" });
  }
  // Оптимистичная блокировка: сразу двигаем метку, чтобы параллельные вкладки не дублировали импорт.
  await supabase.from("bank_connections").update({ last_synced_at: new Date().toISOString() })
    .eq("team_id", teamId).eq("provider", "tochka");

  let token: string;
  try { token = decryptSecret(conn.token_cipher); }
  catch { return NextResponse.json({ ok: true, skipped: "token_error" }); }

  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

  let imported = 0, failed = 0;
  try {
    const accounts = await getAccounts({ token, apiVersion: conn.api_version });
    const ownNumbers = new Set(accounts.map((a) => a.accountNumber).filter(Boolean) as string[]);
    const { data: linkRows } = await supabase
      .from("bank_account_links").select("external_account, account_id")
      .eq("team_id", teamId).eq("provider", "tochka");
    const acctMap = new Map<string, string>();
    for (const l of linkRows ?? []) if (l.account_id) acctMap.set(l.external_account, l.account_id);

    for (const a of accounts) {
      const targetAccountId = (a.accountNumber && acctMap.get(a.accountNumber)) || conn.default_account_id;
      try {
        const r = await importTochkaStatement(supabase, {
          teamId, token, apiVersion: conn.api_version, ownNumbers, acctMap,
          targetAccountId, accountId: a.accountId,
          defaultIncomeCat: conn.default_income_category_id, defaultExpenseCat: conn.default_expense_category_id,
          from, to, createdBy: user.id,
        });
        imported += r.imported;
      } catch { failed++; }
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Ошибка автосинка" }, { status: 502 });
  }

  await supabase.from("bank_connections").update({ last_synced_at: new Date().toISOString() })
    .eq("team_id", teamId).eq("provider", "tochka");
  return NextResponse.json({ ok: true, imported, failed });
}
