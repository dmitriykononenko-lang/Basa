import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";

// Сопоставление счетов Точки со счетами Basa.
export async function GET() {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const supabase = await createClient();
  const { data } = await supabase
    .from("bank_account_links")
    .select("external_account, account_id")
    .eq("team_id", current.team.id)
    .eq("provider", "tochka");
  return NextResponse.json({ ok: true, links: data ?? [] });
}

export async function POST(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  let body: { links?: { external: string; accountId: string | null }[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 }); }
  const links = (body.links ?? []).filter((l) => l.external?.trim());

  const supabase = await createClient();
  // Полная пересборка: удаляем старые, вставляем заданные (с непустым счётом).
  await supabase.from("bank_account_links").delete().eq("team_id", current.team.id).eq("provider", "tochka");
  const rows = links.filter((l) => l.accountId).map((l) => ({
    team_id: current.team.id, provider: "tochka", external_account: l.external.trim(), account_id: l.accountId,
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from("bank_account_links").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  }
  return NextResponse.json({ ok: true, saved: rows.length });
}
