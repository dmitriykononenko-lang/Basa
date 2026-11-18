import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { itemVat, type VatRate } from "@/lib/invoices";

// Массовое заведение уже выставленных счетов (напр. из веб-кабинета Точки).
// Без позиций — только шапка: номер, плательщик, сумма, даты. Статус —
// «ожидает оплаты»; «оплачен» затем проставит сверка по приходу (reconcile).
const rowSchema = z.object({
  number: z.string().optional(),
  buyer_name: z.string().optional(),
  buyer_inn: z.string().optional(),
  buyer_kpp: z.string().optional(),
  amount: z.number().int().nonnegative(),           // минорные единицы, с НДС
  vat_rate: z.enum(["none", "0", "10", "20"]).optional(),
  currency: z.string().optional(),
  issue_date: z.string().optional(),
  payment_expiry_date: z.string().nullable().optional(),
  purpose: z.string().optional(),
});

export async function POST(request: Request) {
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const p = await parseJson(request, z.object({ rows: z.array(rowSchema).min(1).max(500) }));
  if (!p.ok) return p.res;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);
  const rows = p.data.rows
    .map((r) => {
      const buyer = (r.buyer_name ?? "").trim();
      const amount = r.amount;
      const vat = (r.vat_rate ?? "none") as VatRate;
      return {
        team_id: current.team.id,
        number: (r.number ?? "").trim(),
        buyer_name: buyer,
        buyer_inn: (r.buyer_inn ?? "").trim(),
        buyer_kpp: (r.buyer_kpp ?? "").trim(),
        currency: (r.currency ?? "RUB").trim() || "RUB",
        amount,
        vat_amount: itemVat(amount, vat),
        purpose: (r.purpose ?? "").trim(),
        issue_date: r.issue_date || today,
        payment_expiry_date: r.payment_expiry_date || null,
        status: "payment_waiting" as const,
        created_by: user.id,
      };
    })
    // Пропускаем пустые строки (без плательщика и без суммы).
    .filter((r) => r.buyer_name.length > 0 && r.amount > 0);

  if (rows.length === 0) return NextResponse.json({ error: "Нет строк с плательщиком и суммой" }, { status: 400 });

  const { error, count } = await supabase.from("invoices").insert(rows, { count: "exact" });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  return NextResponse.json({ ok: true, inserted: count ?? rows.length });
}
