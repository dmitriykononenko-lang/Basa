import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTeam, canEditFinance } from "@/lib/team";
import { decryptSecret } from "@/lib/crypto";
import { getInvoicePaymentStatus } from "@/lib/tochka";

// Обновить статус инвойса из Точки по documentId.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getCurrentTeam();
  if (!current) return NextResponse.json({ error: "Нет команды" }, { status: 400 });
  if (!canEditFinance(current.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const supabase = await createClient();
  const teamId = current.team.id;

  const { data: inv } = await supabase
    .from("invoices").select("id, tochka_document_id").eq("id", id).eq("team_id", teamId).maybeSingle();
  if (!inv) return NextResponse.json({ error: "Инвойс не найден" }, { status: 404 });
  if (!inv.tochka_document_id) return NextResponse.json({ error: "Счёт не выставлен в Точке" }, { status: 400 });

  const { data: conn } = await supabase
    .from("bank_connections").select("token_cipher, customer_code").eq("team_id", teamId).eq("provider", "tochka").maybeSingle();
  if (!conn?.customer_code) return NextResponse.json({ error: "Нет подключения Точки / customerCode" }, { status: 400 });

  let token: string;
  try { token = decryptSecret(conn.token_cipher); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка токена" }, { status: 500 }); }

  let raw: unknown, status: string;
  try {
    const res = await getInvoicePaymentStatus({ token }, conn.customer_code, inv.tochka_document_id);
    status = res.status; raw = res.raw;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка статуса Точки" }, { status: 502 });
  }

  const s = status.toLowerCase();
  const mapped = /paid|success|оплач/.test(s) ? "paid" : /expired|просроч/.test(s) ? "payment_expired" : "payment_waiting";
  const patch: Record<string, unknown> = { status: mapped };
  if (mapped === "paid") patch.paid_on = new Date().toISOString().slice(0, 10);
  await supabase.from("invoices").update(patch).eq("id", id);

  return NextResponse.json({ ok: true, tochkaStatus: status, status: mapped, raw });
}
