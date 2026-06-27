import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { getAccounts } from "@/lib/tochka";
import { importTochkaStatement } from "@/lib/tochka-import";

// Фоновый автоимпорт выписок Точки по расписанию (Vercel Cron).
// Расписание задаётся в vercel.json. Окно — последние 45 дней (дедуп защищает от
// повторов и подхватывает операции, проведённые задним числом).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOOKBACK_DAYS = 45;

export async function GET(request: Request) {
  // CRON_SECRET одновременно и защита, и «рубильник»: автоимпорт работает ТОЛЬКО в том
  // проекте, где задан этот секрет. Это позволяет держать всё на одном проекте (basa-16bf):
  // зададите CRON_SECRET только там — дубль-проект без секрета будет вхолостую.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: true, skipped: "CRON_SECRET не задан — автоимпорт в этом проекте выключен" });
  }
  // Vercel автоматически шлёт Authorization: Bearer <CRON_SECRET> при наличии env CRON_SECRET.
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Нет service-role ключа" }, { status: 500 });
  }

  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);

  const { data: conns, error: connErr } = await supabase
    .from("bank_connections")
    .select("team_id, token_cipher, api_version, default_account_id, default_income_category_id, default_expense_category_id")
    .eq("provider", "tochka");
  if (connErr) return NextResponse.json({ error: connErr.message }, { status: 500 });

  const summary: Array<Record<string, unknown>> = [];

  for (const conn of conns ?? []) {
    const teamId = conn.team_id as string;
    let imported = 0, accountsOk = 0, accountsFailed = 0;
    try {
      const token = decryptSecret(conn.token_cipher);
      const accounts = await getAccounts({ token, apiVersion: conn.api_version });
      const ownNumbers = new Set(accounts.map((a) => a.accountNumber).filter(Boolean) as string[]);

      const { data: linkRows } = await supabase
        .from("bank_account_links")
        .select("external_account, account_id")
        .eq("team_id", teamId).eq("provider", "tochka");
      const acctMap = new Map<string, string>();
      for (const l of linkRows ?? []) if (l.account_id) acctMap.set(l.external_account, l.account_id);

      for (const a of accounts) {
        const targetAccountId = (a.accountNumber && acctMap.get(a.accountNumber)) || conn.default_account_id;
        try {
          const r = await importTochkaStatement(supabase, {
            teamId,
            token,
            apiVersion: conn.api_version,
            ownNumbers,
            acctMap,
            targetAccountId,
            accountId: a.accountId,
            defaultIncomeCat: conn.default_income_category_id,
            defaultExpenseCat: conn.default_expense_category_id,
            from,
            to,
            createdBy: null, // системный автоимпорт
          });
          imported += r.imported;
          accountsOk++;
        } catch {
          accountsFailed++; // один счёт упал (таймаут/выписка) — не валим остальные
        }
      }

      await supabase.from("bank_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("team_id", teamId).eq("provider", "tochka");

      summary.push({ teamId, imported, accountsOk, accountsFailed });
    } catch (e) {
      summary.push({ teamId, error: e instanceof Error ? e.message : "Ошибка" });
    }
  }

  return NextResponse.json({ ok: true, from, to, teams: summary.length, summary });
}
