import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";

const itemSchema = z.object({
  name: z.string().optional(),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  price: z.number().int().optional(),        // минорные единицы
  vat_rate: z.enum(["none", "0", "10", "20"]).optional(),
});

// Создать/обновить инвойс вместе с позициями.
export async function POST(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const p = await parseJson(
    request,
    z.object({
      id: z.string().uuid().optional(),
      number: z.string().optional(),
      counterparty_id: z.string().uuid().nullable().optional(),
      buyer_name: z.string().optional(),
      buyer_inn: z.string().optional(),
      buyer_kpp: z.string().optional(),
      project_id: z.string().uuid().nullable().optional(),
      purpose: z.string().optional(),
      issue_date: z.string().optional(),
      payment_expiry_date: z.string().nullable().optional(),
      note: z.string().optional(),
      items: z.array(itemSchema).min(1),
      request_id: z.string().uuid().optional(),   // ключ идемпотентности (double submit / ретрай)
    }),
  );
  if (!p.ok) return p.res;
  const b = p.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  // Одна бизнес-команда — один RPC — одна транзакция БД. Раньше здесь было три
  // независимых запроса (update invoices / delete invoice_items / insert
  // invoice_items): при сбое между ними инвойс оставался без позиций, а два
  // параллельных сохранения смешивали позиции (аудит, тесты T2/T3).
  // Итоги (amount/vat_amount) и номер документа считает БД — клиент их не задаёт.
  const { data, error } = await supabase.rpc("invoice_save", {
    p_payload: {
      id: b.id ?? null,
      team_id: current.team.id,
      number: b.number ?? "",
      counterparty_id: b.counterparty_id ?? null,
      buyer_name: b.buyer_name ?? "",
      buyer_inn: b.buyer_inn ?? "",
      buyer_kpp: b.buyer_kpp ?? "",
      project_id: b.project_id ?? null,
      purpose: b.purpose ?? "",
      issue_date: b.issue_date ?? null,
      payment_expiry_date: b.payment_expiry_date ?? null,
      note: b.note ?? "",
      items: b.items.map((it) => ({
        name: it.name ?? "",
        quantity: it.quantity ?? 1,
        unit: it.unit ?? "шт",
        price: it.price ?? 0,
        vat_rate: it.vat_rate ?? "none",
      })),
    },
    p_request_id: b.request_id ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const res = data as { ok?: boolean; id?: string; number?: string; amount?: number; vat_amount?: number } | null;
  if (!res?.ok) return NextResponse.json({ error: "Не удалось сохранить инвойс" }, { status: 400 });
  return NextResponse.json({ ok: true, id: res.id, number: res.number, amount: res.amount, vat_amount: res.vat_amount });
}

// Сменить статус инвойса (ручные переходы: ожидает/оплачен/отменён/черновик).
export async function PATCH(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const p = await parseJson(
    request,
    z.object({
      id: z.string().uuid(),
      status: z.enum(["draft", "payment_waiting", "paid", "payment_expired", "cancelled"]),
    }),
  );
  if (!p.ok) return p.res;
  const { id, status } = p.data;

  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  patch.paid_on = status === "paid" ? new Date().toISOString().slice(0, 10) : null;
  const { error } = await supabase.from("invoices").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}

// Удалить инвойс (позиции — каскадом).
export async function DELETE(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Не указан инвойс" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
