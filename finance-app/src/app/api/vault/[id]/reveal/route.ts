import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam } from "@/lib/team";
import { decryptSecret, vaultKeyConfigured } from "@/lib/vault-crypto";

// Раскрыть (расшифровать) пароль. Доступ проверяется через vault_can_reveal,
// показ фиксируется в vault_access_log. Plaintext возвращается один раз.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!vaultKeyConfigured()) return NextResponse.json({ error: "Парольница не настроена (нет VAULT_KEY)" }, { status: 503 });
  const { id } = await params;
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  // Право на показ — независимая проверка (не полагаемся на видимость строки).
  const { data: allowed, error: checkErr } = await supabase.rpc("vault_can_reveal", { _entry_id: id });
  if (checkErr) return NextResponse.json({ error: checkErr.message }, { status: 400 });
  if (!allowed) return NextResponse.json({ error: "Нет доступа к этому паролю" }, { status: 403 });

  const { data: entry, error } = await supabase
    .from("vault_entries")
    .select("secret_cipher")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!entry || !entry.secret_cipher) return NextResponse.json({ error: "Пароль не задан" }, { status: 404 });

  let secret: string;
  try {
    secret = decryptSecret(entry.secret_cipher as string);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка расшифровки" }, { status: 500 });
  }

  // Журналируем показ (security-definer функция повторно проверяет право).
  const { error: logErr } = await supabase.rpc("vault_log_reveal", { _entry_id: id });
  if (logErr) return NextResponse.json({ error: logErr.message }, { status: 403 });

  return NextResponse.json({ secret });
}
