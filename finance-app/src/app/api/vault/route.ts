import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { encryptSecret, vaultKeyConfigured } from "@/lib/vault-crypto";

// Создать/обновить запись парольницы. Секрет шифруется на сервере.
export async function POST(request: Request) {
  if (!vaultKeyConfigured()) return NextResponse.json({ error: "Парольница не настроена (нет VAULT_KEY)" }, { status: 503 });
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  let body: { id?: string; title?: string; login?: string; url?: string; note?: string; secret?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 }); }

  const title = (body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "Укажите название" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const fields: Record<string, unknown> = {
    title,
    login: (body.login ?? "").trim(),
    url: (body.url ?? "").trim(),
    note: (body.note ?? "").trim(),
  };

  // Секрет шифруем только если прислан (при правке метаданных можно не слать пароль заново).
  if (typeof body.secret === "string" && body.secret.length > 0) {
    try {
      fields.secret_cipher = encryptSecret(body.secret);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка шифрования" }, { status: 500 });
    }
  }

  if (body.id) {
    const { error } = await supabase.from("vault_entries").update(fields).eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true, id: body.id });
  }

  if (!fields.secret_cipher) return NextResponse.json({ error: "Укажите пароль" }, { status: 400 });
  const { data, error } = await supabase
    .from("vault_entries")
    .insert({ team_id: current.team.id, created_by: user.id, ...fields })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true, id: data.id });
}

// Удалить запись.
export async function DELETE(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Не указана запись" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.from("vault_entries").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
