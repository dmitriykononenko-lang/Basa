import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { encryptSecret } from "@/lib/crypto";

// Сохранить/обновить подключение к Точке (JWT-токен + параметры импорта).
export async function POST(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  let body: {
    token?: string; apiVersion?: string;
    defaultAccountId?: string | null;
    incomeCategoryId?: string | null;
    expenseCategoryId?: string | null;
  };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 }); }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const update: Record<string, unknown> = {
    api_version: body.apiVersion?.trim() || "v1.0",
    default_account_id: body.defaultAccountId || null,
    default_income_category_id: body.incomeCategoryId || null,
    default_expense_category_id: body.expenseCategoryId || null,
    updated_at: new Date().toISOString(),
  };

  // Токен шифруем только если прислан (при редактировании настроек можно не слать токен заново).
  if (body.token && body.token.trim()) {
    try {
      update.token_cipher = encryptSecret(body.token.trim());
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка шифрования" }, { status: 500 });
    }
  }

  const { data: existing } = await supabase
    .from("bank_connections")
    .select("id")
    .eq("team_id", current.team.id)
    .eq("provider", "tochka")
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("bank_connections").update(update).eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  } else {
    if (!update.token_cipher) return NextResponse.json({ error: "Укажите токен" }, { status: 400 });
    const { error } = await supabase.from("bank_connections").insert({
      team_id: current.team.id, provider: "tochka", created_by: user.id, ...update,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}

// Удалить подключение.
export async function DELETE() {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_connections")
    .delete()
    .eq("team_id", current.team.id)
    .eq("provider", "tochka");
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
