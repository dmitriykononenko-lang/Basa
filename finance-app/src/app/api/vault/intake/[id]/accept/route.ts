import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canManageTeam } from "@/lib/team";
import { encryptSecret, vaultKeyConfigured } from "@/lib/vault-crypto";

export const dynamic = "force-dynamic";

// Принять запрос (владелец/админ). Данные расшифрованы в браузере владельца;
// пароль шифруется здесь ключом парольницы (как при обычном создании записи),
// после чего шифртекст запроса удаляется.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!vaultKeyConfigured()) return NextResponse.json({ error: "Парольница не настроена (нет VAULT_KEY)" }, { status: 503 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canManageTeam(current.role)) return NextResponse.json({ error: "Только владелец или админ" }, { status: 403 });

  const p = await parseJson(
    request,
    z.object({
      title: z.string().min(1).max(200),
      login: z.string().max(300).optional(),
      url: z.string().max(300).optional(),
      note: z.string().max(4000).optional(),
      secret: z.string().max(500).optional(),
      group_name: z.string().max(120).optional(),
      // доступы, которые клиент добавил сам, — отдельные записи
      extras: z
        .array(
          z.object({
            title: z.string().min(1).max(200),
            login: z.string().max(300).optional(),
            url: z.string().max(300).optional(),
            note: z.string().max(4000).optional(),
            secret: z.string().max(500).optional(),
          }),
        )
        .max(10)
        .optional(),
    }),
  );
  if (!p.ok) return p.res;
  const b = p.data;

  let secretCipher = "";
  if (b.secret) {
    try {
      secretCipher = encryptSecret(b.secret);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка шифрования" }, { status: 500 });
    }
  }

  let extra: { title: string; login: string; url: string; note: string; secret_cipher: string }[] = [];
  try {
    extra = (b.extras ?? []).map((x) => ({
      title: x.title,
      login: x.login ?? "",
      url: x.url ?? "",
      note: x.note ?? "",
      secret_cipher: x.secret ? encryptSecret(x.secret) : "",
    }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка шифрования" }, { status: 500 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vault_intake_accept", {
    _id: id,
    _title: b.title,
    _login: b.login ?? "",
    _url: b.url ?? "",
    _note: b.note ?? "",
    _secret_cipher: secretCipher,
    _group_name: b.group_name ?? "",
    _extra: extra,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, entry_id: data });
}
