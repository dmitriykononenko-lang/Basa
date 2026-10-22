import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { newSyncToken } from "@/lib/obsidian";

// Сгенерировать/перевыпустить токен синхронизации Obsidian. Токен показываем один раз.
export async function POST() {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Нет прав" }, { status: 403 });

  const { token, hash } = newSyncToken();
  const supabase = await createClient();
  const { error } = await supabase
    .from("obsidian_connection")
    .upsert({ team_id: current.team.id, token_hash: hash }, { onConflict: "team_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  return NextResponse.json({ ok: true, token });
}
