import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { intakeLink } from "@/lib/intake-config";

export const dynamic = "force-dynamic";

// Создать запрос доступа у клиента (менеджер+). Ссылка с токеном возвращается
// ОДИН раз — в БД хранится только хеш токена.
export async function POST(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const p = await parseJson(
    request,
    z.object({
      service_kind: z.enum(["amocrm", "kommo", "meta", "google_ads", "other"]),
      service_label: z.string().max(120).optional(),
      project_id: z.string().uuid().nullable().optional(),
      counterparty_id: z.string().uuid().nullable().optional(),
      client_name: z.string().max(120).optional(),
      ttl_hours: z.number().int().min(1).max(168).optional(),
    }),
  );
  if (!p.ok) return p.res;
  const b = p.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vault_intake_create", {
    _team_id: current.team.id,
    _service_kind: b.service_kind,
    _service_label: b.service_label ?? "",
    _project_id: b.project_id ?? null,
    _counterparty_id: b.counterparty_id ?? null,
    _client_name: b.client_name ?? "",
    _ttl_hours: b.ttl_hours ?? 48,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; token: string; expires_at: string } | null;
  if (!row) return NextResponse.json({ error: "Не удалось создать запрос" }, { status: 500 });

  return NextResponse.json(
    { ok: true, id: row.id, url: intakeLink(new URL(request.url).origin, row.token), expires_at: row.expires_at },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Отозвать запрос (менеджер+).
export async function DELETE(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Не указан запрос" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.rpc("vault_intake_revoke", { _id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
