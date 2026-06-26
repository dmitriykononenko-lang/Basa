import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { decryptSecret } from "@/lib/crypto";
import { getAccounts, fetchStatementRaw } from "@/lib/tochka";
import { importTochkaStatement } from "@/lib/tochka-import";

// Загрузка крупной выписки идёт окнами с «шагами назад» — может занять до минут.
export const maxDuration = 300;

// Импорт операций из Точки за период в транзакции (с дедупом и пометкой переводов).
// ?debug=1 — вернуть сырые операции из выписки без вставки (для сверки полей).
export async function POST(request: Request) {
  const debug = new URL(request.url).searchParams.get("debug") === "1";
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  let body: { tochkaAccountId?: string; from?: string; to?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 }); }
  const from = body.from?.slice(0, 10);
  const to = body.to?.slice(0, 10);
  if (!from || !to) return NextResponse.json({ error: "Укажите период" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data: conn } = await supabase
    .from("bank_connections")
    .select("token_cipher, api_version, default_account_id, default_income_category_id, default_expense_category_id")
    .eq("team_id", current.team.id)
    .eq("provider", "tochka")
    .maybeSingle();
  if (!conn) return NextResponse.json({ error: "Точка не подключена" }, { status: 404 });

  let token: string;
  try { token = decryptSecret(conn.token_cipher); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка токена" }, { status: 500 }); }

  // Свои счета — для определения переводов между ними.
  let ownNumbers: Set<string>;
  let accountId: string;
  let sourceNumber: string | null = null;
  try {
    const accounts = await getAccounts({ token, apiVersion: conn.api_version });
    if (accounts.length === 0) return NextResponse.json({ error: "У токена нет доступных счетов" }, { status: 502 });
    ownNumbers = new Set(accounts.map((a) => a.accountNumber).filter(Boolean) as string[]);
    accountId = body.tochkaAccountId || accounts[0].accountId;
    sourceNumber = accounts.find((a) => a.accountId === accountId)?.accountNumber ?? null;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка счетов" }, { status: 502 });
  }

  // Сопоставление счетов Точки со счетами Basa (номер → account_id Basa).
  const { data: linkRows } = await supabase
    .from("bank_account_links")
    .select("external_account, account_id")
    .eq("team_id", current.team.id)
    .eq("provider", "tochka");
  const acctMap = new Map<string, string>();
  for (const l of linkRows ?? []) if (l.account_id) acctMap.set(l.external_account, l.account_id);
  // Счёт Basa для импортируемой выписки: маппинг → иначе дефолтный.
  const targetAccountId = (sourceNumber && acctMap.get(sourceNumber)) || conn.default_account_id;

  if (debug) {
    try {
      const raw = await fetchStatementRaw({ token, apiVersion: conn.api_version, accountId, from, to });
      return NextResponse.json({ ok: true, raw });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка выписки" }, { status: 502 });
    }
  }

  let result;
  try {
    result = await importTochkaStatement(supabase, {
      teamId: current.team.id,
      token,
      apiVersion: conn.api_version,
      ownNumbers,
      acctMap,
      targetAccountId,
      accountId,
      defaultIncomeCat: conn.default_income_category_id,
      defaultExpenseCat: conn.default_expense_category_id,
      from,
      to,
      createdBy: user.id,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка выписки" }, { status: 502 });
  }

  await supabase.from("bank_connections").update({ last_synced_at: new Date().toISOString() }).eq("team_id", current.team.id).eq("provider", "tochka");

  return NextResponse.json({ ok: true, ...result });
}
