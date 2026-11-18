import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canManageTeam } from "@/lib/team";

export const dynamic = "force-dynamic";

// Сохранить ключ команды (владелец/админ). Пара ключей создана в браузере;
// сюда приходит открытый ключ и закрытый ключ, уже зашифрованный паролем.
export async function POST(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canManageTeam(current.role)) return NextResponse.json({ error: "Только владелец или админ" }, { status: 403 });

  const p = await parseJson(
    request,
    z.object({
      public_key: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
      wrapped: z.object({
        v: z.literal(1),
        kdf: z.literal("PBKDF2"),
        hash: z.literal("SHA-256"),
        iter: z.number().int().min(310000),
        salt: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
        iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
        ct: z.string().regex(/^[A-Za-z0-9_-]{100,400}$/),
      }).strict(),
    }),
  );
  if (!p.ok) return p.res;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vault_team_key_set", {
    _team_id: current.team.id,
    _public_key: p.data.public_key,
    _wrapped: p.data.wrapped,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, key_id: data });
}
