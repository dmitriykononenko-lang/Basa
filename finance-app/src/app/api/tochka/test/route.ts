import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { decryptSecret } from "@/lib/crypto";
import { getAccounts, getAccountsRaw } from "@/lib/tochka";

// Проверка подключения: тянем список счетов из Точки на сохранённом токене.
// ?debug=1 — вернуть сырой JSON ответа Точки для сверки маппинга полей.
export async function GET(request: Request) {
  const debug = new URL(request.url).searchParams.get("debug") === "1";
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const supabase = await createClient();
  const { data: conn } = await supabase
    .from("bank_connections")
    .select("token_cipher, api_version")
    .eq("team_id", current.team.id)
    .eq("provider", "tochka")
    .maybeSingle();
  if (!conn) return NextResponse.json({ error: "Точка не подключена" }, { status: 404 });

  try {
    const token = decryptSecret(conn.token_cipher);
    const accounts = await getAccounts({ token, apiVersion: conn.api_version });
    const raw = debug ? await getAccountsRaw({ token, apiVersion: conn.api_version }) : undefined;
    return NextResponse.json({ ok: true, accounts, raw });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка подключения" }, { status: 502 });
  }
}
