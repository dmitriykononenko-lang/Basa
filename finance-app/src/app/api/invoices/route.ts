import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { itemAmount, invoiceTotals, type VatRate } from "@/lib/invoices";

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
    }),
  );
  if (!p.ok) return p.res;
  const b = p.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  // Плательщик из контрагента — подтянем название/ИНН, если не заданы вручную.
  let buyerName = (b.buyer_name ?? "").trim();
  let buyerInn = (b.buyer_inn ?? "").trim();
  if (b.counterparty_id) {
    const { data: cp } = await supabase
      .from("counterparties").select("name, inn").eq("id", b.counterparty_id).eq("team_id", current.team.id).maybeSingle();
    if (!cp) return NextResponse.json({ error: "Контрагент не найден" }, { status: 400 });
    if (!buyerName) buyerName = cp.name ?? "";
    if (!buyerInn) buyerInn = (cp.inn ?? "") as string;
  }
  if (!buyerName) return NextResponse.json({ error: "Укажите плательщика (контрагента или название)" }, { status: 400 });

  // Пересчёт позиций и итогов на сервере.
  const items = b.items.map((it, i) => {
    const quantity = Number.isFinite(it.quantity) ? (it.quantity as number) : 1;
    const price = it.price ?? 0;
    const amount = itemAmount(quantity, price);
    return {
      name: (it.name ?? "").trim(),
      quantity,
      unit: (it.unit ?? "шт").trim() || "шт",
      price,
      vat_rate: (it.vat_rate ?? "none") as VatRate,
      amount,
      sort: i,
    };
  });
  if (items.every((it) => it.amount <= 0)) return NextResponse.json({ error: "Добавьте хотя бы одну позицию с суммой" }, { status: 400 });
  const totals = invoiceTotals(items);

  const fields = {
    team_id: current.team.id,
    number: (b.number ?? "").trim(),
    counterparty_id: b.counterparty_id ?? null,
    buyer_name: buyerName,
    buyer_inn: buyerInn,
    buyer_kpp: (b.buyer_kpp ?? "").trim(),
    project_id: b.project_id ?? null,
    amount: totals.amount,
    vat_amount: totals.vat_amount,
    purpose: (b.purpose ?? "").trim(),
    issue_date: b.issue_date || new Date().toISOString().slice(0, 10),
    payment_expiry_date: b.payment_expiry_date || null,
    note: (b.note ?? "").trim(),
  };

  let invoiceId = b.id;
  if (invoiceId) {
    const { error } = await supabase.from("invoices").update(fields).eq("id", invoiceId);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  } else {
    const { data, error } = await supabase
      .from("invoices").insert({ ...fields, created_by: user.id }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    invoiceId = data.id;
  }

  // Перезаписываем позиции.
  await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
  const { error: itErr } = await supabase.from("invoice_items").insert(
    items.map((it) => ({ ...it, invoice_id: invoiceId, team_id: current.team.id })),
  );
  if (itErr) return NextResponse.json({ error: itErr.message }, { status: 403 });

  return NextResponse.json({ ok: true, id: invoiceId });
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
