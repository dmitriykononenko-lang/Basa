import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { decryptSecret } from "@/lib/crypto";
import { fetchOperations } from "@/lib/tochka";

// Подсказка сопоставления: по выписке одного счёта Точки определяем
// преобладающее упоминание «фонд X» в назначениях — это и есть его смысл.
export async function POST(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  let body: { tochkaAccountId?: string; from?: string; to?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 }); }
  const from = body.from?.slice(0, 10);
  const to = body.to?.slice(0, 10);
  if (!body.tochkaAccountId || !from || !to) return NextResponse.json({ error: "Укажите счёт и период" }, { status: 400 });

  const supabase = await createClient();
  const { data: conn } = await supabase
    .from("bank_connections")
    .select("token_cipher, api_version")
    .eq("team_id", current.team.id).eq("provider", "tochka").maybeSingle();
  if (!conn) return NextResponse.json({ error: "Точка не подключена" }, { status: 404 });

  let ops;
  try {
    const token = decryptSecret(conn.token_cipher);
    ops = await fetchOperations({ token, apiVersion: conn.api_version, accountId: body.tochkaAccountId, from, to });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка выписки" }, { status: 502 });
  }

  // Тэллим упоминания «фонд <слово(а)>» в назначениях.
  const funds = new Map<string, number>();
  for (const o of ops) {
    const m = (o.description ?? "").match(/фонд[ауеы]?\s+([А-ЯЁа-яё][А-ЯЁа-яё ]{2,30}?)(?:\s+с\s+операци|\.|,| без|$)/iu);
    if (m) {
      const name = m[1].trim().replace(/\s+/g, " ").toLowerCase();
      funds.set(name, (funds.get(name) ?? 0) + 1);
    }
  }
  const top = [...funds.entries()].sort((a, b) => b[1] - a[1]);
  return NextResponse.json({ ok: true, opsCount: ops.length, topFund: top[0]?.[0] ?? null, funds: Object.fromEntries(top.slice(0, 5)) });
}
